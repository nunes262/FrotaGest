"""Exclusão definitiva de um motorista já removido: apaga os dados dele e o que só existe por causa dele."""

import logging
from pathlib import Path

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import (
    Conversation,
    ConversationKind,
    ConversationMember,
    Delivery,
    DeliveryProof,
    DeliveryRun,
    DriverPayment,
    FuelEntry,
    Message,
    Position,
    PushSubscription,
    RouteExpense,
    RunPause,
    RunPoint,
    RunStatus,
    User,
    Vehicle,
    VehicleChecklist,
)
from app.services import checklists
from app.schemas.fleet import DriverPurge

log = logging.getLogger(__name__)


def count_delete(db: Session, model, *where) -> int:
    """Apaga as linhas e devolve quantas eram."""
    count = db.scalar(select(func.count()).select_from(model).where(*where)) or 0
    if count:
        db.execute(delete(model).where(*where))
    return count


def purge_driver(db: Session, driver: User) -> DriverPurge:
    """Apaga cadastro, rotas, pontos de GPS, pausas, comprovantes (e as fotos), os valores lançados para ele (a pagar e
    pagos), as mensagens dele e as conversas individuais com ele. As entregas são registros da empresa: ficam, sem o nome dele. Os km das rotas apagadas
    continuam no total de cada veículo, para o desgaste dos pneus não "voltar"."""
    runs = select(DeliveryRun.id).where(DeliveryRun.driver_id == driver.id)
    for vehicle_id, km in db.execute(
        select(DeliveryRun.vehicle_id, func.sum(DeliveryRun.distance_km))
        .where(DeliveryRun.driver_id == driver.id, DeliveryRun.status == RunStatus.finished)
        .group_by(DeliveryRun.vehicle_id)
    ):
        vehicle = db.get(Vehicle, vehicle_id)
        vehicle.archived_route_km = (vehicle.archived_route_km or 0) + (km or 0)

    db.execute(update(RouteExpense).where(RouteExpense.run_id.in_(runs)).values(run_id=None))
    db.execute(update(VehicleChecklist).where(VehicleChecklist.run_id.in_(runs)).values(run_id=None))
    db.execute(update(FuelEntry).where(FuelEntry.run_id.in_(runs)).values(run_id=None))
    db.execute(update(Delivery).where(Delivery.run_id.in_(runs)).values(run_id=None))
    gps = count_delete(db, RunPoint, RunPoint.run_id.in_(runs))
    count_delete(db, RunPause, RunPause.run_id.in_(runs))
    run_count = count_delete(db, DeliveryRun, DeliveryRun.driver_id == driver.id)
    payment_count = count_delete(db, DriverPayment, DriverPayment.driver_id == driver.id)
    gps += count_delete(db, Position, Position.driver_id == driver.id)

    photos = list(db.scalars(select(DeliveryProof.photo_path).where(DeliveryProof.driver_id == driver.id)))
    photos += [p for p in db.scalars(select(DeliveryProof.signature_path).where(DeliveryProof.driver_id == driver.id)) if p]
    proofs = count_delete(db, DeliveryProof, DeliveryProof.driver_id == driver.id)
    # Checklists, abastecimentos, despesas (com as fotos) e os aparelhos inscritos para notificações
    for c in db.scalars(select(VehicleChecklist).where(VehicleChecklist.driver_id == driver.id)):
        photos += checklists.photos(c)
    photos += list(db.scalars(select(FuelEntry.photo_path).where(FuelEntry.driver_id == driver.id)))
    photos += list(db.scalars(select(RouteExpense.photo_path).where(RouteExpense.driver_id == driver.id)))
    count_delete(db, VehicleChecklist, VehicleChecklist.driver_id == driver.id)
    count_delete(db, FuelEntry, FuelEntry.driver_id == driver.id)
    count_delete(db, RouteExpense, RouteExpense.driver_id == driver.id)
    count_delete(db, PushSubscription, PushSubscription.user_id == driver.id)

    # Conversas individuais com ele somem inteiras; nos grupos, só as mensagens dele
    directs = select(ConversationMember.conversation_id).join(
        Conversation, Conversation.id == ConversationMember.conversation_id
    ).where(ConversationMember.user_id == driver.id, Conversation.kind == ConversationKind.direct)
    direct_ids = list(db.scalars(directs))
    messages = count_delete(db, Message, Message.conversation_id.in_(direct_ids))
    messages += count_delete(db, Message, Message.sender_id == driver.id)
    db.execute(delete(ConversationMember).where(ConversationMember.conversation_id.in_(direct_ids)))
    db.execute(delete(Conversation).where(Conversation.id.in_(direct_ids)))
    db.execute(delete(ConversationMember).where(ConversationMember.user_id == driver.id))

    kept = db.scalar(select(func.count()).select_from(Delivery).where(Delivery.driver_id == driver.id)) or 0
    db.execute(update(Delivery).where(Delivery.driver_id == driver.id).values(driver_id=None, stop_order=None))
    db.execute(update(Vehicle).where(Vehicle.current_driver_id == driver.id).values(current_driver_id=None))

    name = driver.name
    db.delete(driver)
    db.commit()

    # As fotos só saem do disco depois que o banco confirmou
    folder = Path(get_settings().upload_dir)
    for relative in photos:
        try:
            (folder / relative).unlink(missing_ok=True)
        except OSError as e:
            log.warning("Não consegui apagar a foto %s: %s", relative, e)

    return DriverPurge(
        name=name, runs=run_count, gps_points=gps, messages=messages, proofs=proofs, deliveries_kept=kept, payments=payment_count,
    )
