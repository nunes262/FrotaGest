"""Exclusão de veículo com o histórico que só existe por causa dele."""

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import (
    Delivery, DeliveryRun, FuelEntry, Position, RouteExpense, VehicleChecklist, RunPause, RunPoint, RunStatus, Tire, TireEvent, TrackerSimulation, User, Vehicle,
)
from app.schemas.fleet import VehicleDeletion, VehicleUsage
from app.services import checklists, uploads
from app.services.drivers import count_delete


def _count(db: Session, model, *where) -> int:
    return db.scalar(select(func.count()).select_from(model).where(*where)) or 0


def usage(db: Session, vehicle: Vehicle) -> VehicleUsage:
    driver = db.get(User, vehicle.current_driver_id) if vehicle.current_driver_id else None
    return VehicleUsage(
        driver_name=driver.name if driver else None,
        positions=_count(db, Position, Position.vehicle_id == vehicle.id),
        runs=_count(db, DeliveryRun, DeliveryRun.vehicle_id == vehicle.id),
        tires=_count(db, Tire, Tire.vehicle_id == vehicle.id),
        active_run=_count(db, DeliveryRun, DeliveryRun.vehicle_id == vehicle.id, DeliveryRun.status == RunStatus.active) > 0,
    )


def delete_vehicle(db: Session, vehicle: Vehicle) -> VehicleDeletion:
    """Apaga o veículo, as posições do rastreador, as rotas feitas com ele (pontos e pausas) e os pneus com o histórico.
    As entregas não mudam: elas são do motorista, não do veículo."""
    if _count(db, DeliveryRun, DeliveryRun.vehicle_id == vehicle.id, DeliveryRun.status == RunStatus.active):
        raise HTTPException(status.HTTP_409_CONFLICT, "O veículo está numa rota em andamento. Encerre a rota antes de excluir.")
    runs = select(DeliveryRun.id).where(DeliveryRun.vehicle_id == vehicle.id)
    db.execute(update(Delivery).where(Delivery.run_id.in_(runs)).values(run_id=None))
    # Despesas são do motorista (dinheiro): ficam, sem a rota. Checklists e abastecimentos são do veículo: saem com ele
    db.execute(update(RouteExpense).where(RouteExpense.run_id.in_(runs)).values(run_id=None))
    photos = [p for c in db.scalars(select(VehicleChecklist).where(VehicleChecklist.vehicle_id == vehicle.id)) for p in checklists.photos(c)]
    photos += list(db.scalars(select(FuelEntry.photo_path).where(FuelEntry.vehicle_id == vehicle.id)))
    count_delete(db, VehicleChecklist, VehicleChecklist.vehicle_id == vehicle.id)
    count_delete(db, FuelEntry, FuelEntry.vehicle_id == vehicle.id)
    count_delete(db, RunPoint, RunPoint.run_id.in_(runs))
    count_delete(db, RunPause, RunPause.run_id.in_(runs))
    run_count = count_delete(db, DeliveryRun, DeliveryRun.vehicle_id == vehicle.id)
    positions = count_delete(db, Position, Position.vehicle_id == vehicle.id)
    count_delete(db, TireEvent, TireEvent.tire_id.in_(select(Tire.id).where(Tire.vehicle_id == vehicle.id)))
    tires = count_delete(db, Tire, Tire.vehicle_id == vehicle.id)
    count_delete(db, TrackerSimulation, TrackerSimulation.vehicle_id == vehicle.id)
    plate = vehicle.plate
    db.delete(vehicle)
    db.commit()
    uploads.remove(*photos)
    return VehicleDeletion(plate=plate, positions=positions, runs=run_count, tires=tires)
