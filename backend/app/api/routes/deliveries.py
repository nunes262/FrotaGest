from datetime import date, datetime
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func, select

from app.api.deps import AdminUser, CurrentUser, DbSession, DriverUser
from app.core.config import get_settings
from app.models import Delivery, DeliveryProof, DeliveryStatus, User, UserRole
from app.schemas.deliveries import DeliveryAssign, DeliveryCreate, DeliveryOut, FailureReason
from app.services import notify, runs, uploads
from app.services.chat_hub import hub

router = APIRouter(prefix="/deliveries", tags=["carregamento"])

MAX_RANGE_DAYS = 62


def _today() -> date:
    return datetime.now(ZoneInfo(get_settings().timezone)).date()


@router.get("", response_model=list[DeliveryOut])
def list_deliveries(
    db: DbSession, user: CurrentUser, day: date | None = None, date_from: date | None = None, date_to: date | None = None
):
    """Entregas do dia (hoje, se não informado) ou do período date_from–date_to. O motorista vê só as que estão com ele."""
    q = select(Delivery).where(Delivery.company_id == user.company_id)
    if date_from or date_to:
        if not (date_from and date_to) or date_from > date_to or (date_to - date_from).days > MAX_RANGE_DAYS:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, f"Informe date_from e date_to, com até {MAX_RANGE_DAYS} dias entre eles."
            )
        q = q.where(Delivery.scheduled_for.between(date_from, date_to))
    else:
        q = q.where(Delivery.scheduled_for == (day or _today()))
    if user.role == UserRole.driver:
        q = q.where(Delivery.driver_id == user.id)
    return runs.with_proofs(db, db.scalars(q.order_by(Delivery.scheduled_for, Delivery.stop_order, Delivery.id)))


@router.post("", response_model=DeliveryOut, status_code=status.HTTP_201_CREATED)
def create_delivery(data: DeliveryCreate, db: DbSession, admin: AdminUser):
    delivery = Delivery(company_id=admin.company_id, status=DeliveryStatus.pending, **data.model_dump())
    db.add(delivery)
    db.commit()
    return delivery


@router.post("/assign", response_model=list[DeliveryOut])
async def assign_deliveries(data: DeliveryAssign, db: DbSession, admin: AdminUser, background: BackgroundTasks):
    """Coloca as entregas no caminhão do motorista, na ordem enviada, depois das paradas que ele já tem.
    Com driver_id nulo, devolve as entregas para a fila de carregamento.
    Avisa na hora, pelo WebSocket, o motorista que recebeu e os que perderam entregas."""
    ids = list(dict.fromkeys(data.delivery_ids))
    found = {
        d.id: d
        for d in db.scalars(select(Delivery).where(Delivery.id.in_(ids), Delivery.company_id == admin.company_id))
    }
    if len(found) != len(ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alguma entrega não foi encontrada.")
    deliveries = [found[i] for i in ids]
    if any(d.status == DeliveryStatus.delivered for d in deliveries):
        raise HTTPException(status.HTTP_409_CONFLICT, "Entregas já concluídas não podem ser redistribuídas.")
    # As não entregues podem voltar para a fila ou ir para outro caminhão (nova tentativa)

    previous_drivers = {d.driver_id for d in deliveries if d.driver_id and d.driver_id != data.driver_id}
    received: list[Delivery] = []
    if data.driver_id is None:
        for d in deliveries:
            runs.release(db, d)
            d.driver_id, d.stop_order, d.status = None, None, DeliveryStatus.pending
    else:
        driver = db.get(User, data.driver_id)
        if not driver or driver.company_id != admin.company_id or driver.role != UserRole.driver or not driver.active:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Motorista não encontrado.")
        next_stop: dict[date, int] = {}
        for d in deliveries:
            if d.driver_id == driver.id:
                continue
            day = d.scheduled_for
            if day not in next_stop:
                last = db.scalar(
                    select(func.max(Delivery.stop_order)).where(Delivery.driver_id == driver.id, Delivery.scheduled_for == day)
                )
                next_stop[day] = (last or 0) + 1
            runs.release(db, d)
            d.driver_id, d.stop_order, d.status = driver.id, next_stop[day], DeliveryStatus.assigned
            next_stop[day] += 1
            received.append(d)
    db.commit()

    if received:
        notice = {
            "day": min(d.scheduled_for for d in received).isoformat(),
            "count": len(received),
            "weight_kg": sum(d.weight_kg for d in received),
            "assigned_by": admin.name,
        }
        await notify.send([([data.driver_id], {"type": "deliveries_assigned", "data": notice})])
        # Já localiza os endereços no mapa, para o motorista não esperar ao iniciar a rota
        background.add_task(runs.prefetch_locations, [d.id for d in received], runs.base_point(db, admin.company_id))
    if previous_drivers:
        await hub.send_to_users(list(previous_drivers), {"type": "deliveries_changed"})
    return runs.with_proofs(db, deliveries)


@router.delete("/{delivery_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_delivery(delivery_id: int, db: DbSession, admin: AdminUser):
    delivery = db.get(Delivery, delivery_id)
    if not delivery or delivery.company_id != admin.company_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entrega não encontrada.")
    if delivery.status != DeliveryStatus.pending:
        raise HTTPException(status.HTTP_409_CONFLICT, "Devolva a entrega para a fila antes de excluir.")
    db.delete(delivery)
    db.commit()


OUTCOME_STATUS = {"delivered": DeliveryStatus.delivered, "failed": DeliveryStatus.failed}


@router.post("/{delivery_id}/outcome", response_model=DeliveryOut)
async def register_outcome(
    delivery_id: int,
    db: DbSession,
    driver: DriverUser,
    outcome: Annotated[Literal["delivered", "failed"], Form()],
    photo: Annotated[UploadFile, File(description="Foto do canhoto, da mercadoria entregue ou do local")],
    reason: Annotated[FailureReason | None, Form()] = None,
    note: Annotated[str | None, Form(max_length=500)] = None,
    latitude: Annotated[float | None, Form(ge=-90, le=90)] = None,
    longitude: Annotated[float | None, Form(ge=-180, le=180)] = None,
    receiver_name: Annotated[str | None, Form(max_length=120)] = None,
    receiver_document: Annotated[str | None, Form(max_length=20)] = None,
    signature: Annotated[UploadFile | None, File(description="Assinatura de quem recebeu (PNG)")] = None,
    client_id: Annotated[str | None, Form(max_length=36)] = None,
    recorded_at: Annotated[datetime | None, Form()] = None,
):
    """O motorista, no endereço, conta o que aconteceu com uma foto: entregue (com o nome e a assinatura de quem
    recebeu) ou o cliente não recebeu. O gestor recebe o aviso na hora pelo WebSocket.
    Feito sem sinal, o celular reenvia depois com o mesmo client_id e a hora em que foi registrado."""
    delivery = db.get(Delivery, delivery_id)
    if not delivery or delivery.company_id != driver.company_id or delivery.driver_id != driver.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entrega não encontrada.")
    if client_id and db.scalar(select(DeliveryProof.id).where(DeliveryProof.client_id == client_id, DeliveryProof.delivery_id == delivery.id)):
        return runs.with_proofs(db, [delivery])[0]  # reenvio de um registro que já chegou
    if delivery.status == DeliveryStatus.delivered:
        raise HTTPException(status.HTTP_409_CONFLICT, "Essa entrega já foi concluída.")
    if outcome == "failed" and not reason:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Diga por que o cliente não recebeu.")
    relative = await uploads.save_image(photo, "proofs", driver.company_id)
    signature_path = await uploads.save_image(signature, "signatures", driver.company_id, "assinatura") if signature else None

    db.add(DeliveryProof(
        delivery_id=delivery.id, company_id=driver.company_id, driver_id=driver.id, outcome=outcome,
        reason=reason if outcome == "failed" else None, note=(note or "").strip() or None,
        photo_path=relative, latitude=latitude, longitude=longitude, created_at=uploads.when_recorded(recorded_at),
        receiver_name=(receiver_name or "").strip() or None if outcome == "delivered" else None,
        receiver_document=(receiver_document or "").strip() or None if outcome == "delivered" else None,
        signature_path=signature_path if outcome == "delivered" else None, client_id=client_id,
    ))
    delivery.status = OUTCOME_STATUS[outcome]
    db.commit()

    notice = {
        "delivery_id": delivery.id, "customer_name": delivery.customer_name, "driver_name": driver.name,
        "outcome": outcome, "reason": reason if outcome == "failed" else None,
    }
    await notify.send([(runs.admin_ids(db, driver.company_id), {"type": "delivery_outcome", "data": notice})])
    return runs.with_proofs(db, [delivery])[0]


def _visible_delivery(db: DbSession, delivery_id: int, user: User) -> Delivery:
    delivery = db.get(Delivery, delivery_id)
    if not delivery or delivery.company_id != user.company_id or (user.role == UserRole.driver and delivery.driver_id != user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entrega não encontrada.")
    return delivery


def _latest_proof(db: DbSession, delivery: Delivery) -> DeliveryProof | None:
    return db.scalar(select(DeliveryProof).where(DeliveryProof.delivery_id == delivery.id).order_by(DeliveryProof.id.desc()).limit(1))


@router.get("/{delivery_id}/proof/photo")
def proof_photo(delivery_id: int, db: DbSession, user: CurrentUser):
    """Foto do comprovante mais recente. O motorista só vê as das entregas dele."""
    proof = _latest_proof(db, _visible_delivery(db, delivery_id, user))
    return uploads.file_response(proof.photo_path if proof else None, "Essa entrega não tem foto.")


@router.get("/{delivery_id}/proof/signature")
def proof_signature(delivery_id: int, db: DbSession, user: CurrentUser):
    """Assinatura de quem recebeu, feita na tela do celular."""
    proof = _latest_proof(db, _visible_delivery(db, delivery_id, user))
    return uploads.file_response(proof.signature_path if proof else None, "Essa entrega não tem assinatura.")
