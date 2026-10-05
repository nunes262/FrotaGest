"""Fotos enviadas pelo motorista (comprovantes, assinatura, checklist, cupons de abastecimento e despesas)."""

import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from app.core.config import get_settings
from app.services.geo import as_utc

IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif"}
# Registro feito sem sinal e enviado depois: vale a hora em que foi feito no celular, dentro desse limite
OFFLINE_WINDOW = timedelta(hours=48)


def path(relative: str) -> Path:
    return Path(get_settings().upload_dir) / relative


async def save_image(file: UploadFile, folder: str, company_id: int, label: str = "foto") -> str:
    """Grava a imagem e devolve o caminho relativo à pasta de uploads."""
    ext = IMAGE_TYPES.get(file.content_type or "")
    if not ext:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Envie a {label} em JPG, PNG, WEBP ou HEIC.")
    limit = get_settings().max_photo_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"A {label} passa de {get_settings().max_photo_mb} MB.")
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"A {label} chegou vazia. Tente de novo.")
    relative = f"{folder}/{company_id}/{uuid.uuid4().hex}.{ext}"
    target = path(relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return relative


def remove(*relatives: str | None) -> None:
    for relative in relatives:
        if relative:
            path(relative).unlink(missing_ok=True)


def file_response(relative: str | None, missing: str) -> FileResponse:
    if not relative or not path(relative).is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, missing)
    return FileResponse(path(relative), headers={"Cache-Control": "private, max-age=86400"})


def when_recorded(value: datetime | None) -> datetime:
    """Hora do registro: a do celular (feito sem sinal) se for plausível, senão agora."""
    now = datetime.now(timezone.utc)
    if value is None:
        return now
    value = as_utc(value)
    return value if now - OFFLINE_WINDOW <= value <= now + timedelta(minutes=5) else now
