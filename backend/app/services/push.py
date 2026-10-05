"""Notificações no celular mesmo com o app fechado (Web Push). Quem está com o app aberto recebe pela tela."""

import asyncio
import base64
import json
import logging
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid
from pywebpush import WebPushException, webpush
from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import PushSubscription
from app.services.chat_hub import hub

log = logging.getLogger(__name__)
_vapid: Vapid | None = None


def vapid() -> Vapid:
    """Chave do servidor para o Web Push, criada na primeira vez e guardada em arquivo (não troque: os aparelhos
    inscritos deixariam de receber)."""
    global _vapid
    if _vapid is None:
        path = Path(get_settings().vapid_key_file)
        if path.is_file():
            _vapid = Vapid.from_file(str(path))
        else:
            _vapid = Vapid()
            _vapid.generate_keys()
            _vapid.save_key(str(path))
    return _vapid


def public_key() -> str:
    raw = vapid().public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _send_all(user_ids: list[int], payload: dict) -> None:
    with SessionLocal() as db:
        for sub in db.scalars(select(PushSubscription).where(PushSubscription.user_id.in_(user_ids))):
            try:
                webpush(
                    {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                    data=json.dumps(payload), vapid_private_key=vapid(),
                    vapid_claims={"sub": get_settings().vapid_subject}, ttl=3600, timeout=10,
                )
            except WebPushException as e:
                if e.response is not None and e.response.status_code in (404, 410):
                    db.delete(sub)  # o aparelho cancelou a inscrição
                else:
                    log.warning("Notificação não enviada: %s", e)
            except Exception as e:  # rede fora: o aviso pela tela continua valendo
                log.warning("Notificação não enviada: %s", e)
        db.commit()


async def notify(user_ids: list[int], title: str, body: str, url: str = "/") -> None:
    """Manda para os aparelhos inscritos de quem não está com o app aberto agora."""
    targets = sorted({u for u in user_ids if u and not hub.is_online(u)})
    if not targets:
        return
    with SessionLocal() as db:
        if not db.scalar(select(PushSubscription.id).where(PushSubscription.user_id.in_(targets)).limit(1)):
            return
    await asyncio.to_thread(_send_all, targets, {"title": title, "body": body, "url": url})
