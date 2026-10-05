"""Abastecimentos: o motorista registra litros, valor, hodômetro e a foto do cupom; o gestor vê o gasto real."""

from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import DeliveryRun, FuelEntry, RunStatus, User, UserRole, Vehicle
from app.schemas.operations import FuelEntryOut
from app.services import uploads
from app.services.geo import as_utc

# Fora disso o mais provável é erro de digitação (litros e valor trocados, vírgula no lugar errado)
PRICE_RANGE = (2.0, 15.0)


async def create(db: Session, driver: User, *, liters: float, total: float, odometer_km: float | None, fuel_type: str | None,
                 full_tank: bool, station: str | None, photo: UploadFile, latitude: float | None, longitude: float | None,
                 client_id: str | None, recorded_at: datetime | None) -> FuelEntry:
    if client_id and (done := db.scalar(select(FuelEntry).where(FuelEntry.client_id == client_id, FuelEntry.driver_id == driver.id))):
        return done  # reenvio (sem sinal) de um abastecimento que já chegou
    vehicle = db.scalar(select(Vehicle).where(Vehicle.current_driver_id == driver.id).order_by(Vehicle.id).limit(1))
    if not vehicle:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cadastre seu veículo em “Meu veículo” para registrar o abastecimento.")
    price = total / liters
    if not PRICE_RANGE[0] <= price <= PRICE_RANGE[1]:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Confira os litros e o valor: daria R$ {price:.2f} o litro.".replace(".", ","),
        )
    run = db.scalar(select(DeliveryRun).where(DeliveryRun.driver_id == driver.id, DeliveryRun.status == RunStatus.active))
    entry = FuelEntry(
        company_id=driver.company_id, vehicle_id=vehicle.id, driver_id=driver.id, run_id=run.id if run else None,
        filled_at=uploads.when_recorded(recorded_at), liters=round(liters, 2), total_cents=round(total * 100),
        odometer_km=odometer_km, fuel_type=fuel_type or vehicle.fuel_type or "diesel", full_tank=full_tank,
        station=(station or "").strip() or None, latitude=latitude, longitude=longitude, client_id=client_id,
        photo_path=await uploads.save_image(photo, "fuel", driver.company_id, "foto do cupom"),
    )
    db.add(entry)
    db.commit()
    return entry


def entries(db: Session, user: User, date_from: date, date_to: date, vehicle_id: int | None = None) -> list[FuelEntry]:
    tz = ZoneInfo(get_settings().timezone)
    start = datetime.combine(date_from, time.min, tzinfo=tz)
    end = datetime.combine(date_to, time.max, tzinfo=tz)
    q = select(FuelEntry).where(FuelEntry.company_id == user.company_id, FuelEntry.filled_at.between(start, end))
    if user.role == UserRole.driver:
        q = q.where(FuelEntry.driver_id == user.id)
    if vehicle_id:
        q = q.where(FuelEntry.vehicle_id == vehicle_id)
    return list(db.scalars(q.order_by(FuelEntry.filled_at.desc())))


def out(db: Session, rows: list[FuelEntry]) -> list[FuelEntryOut]:
    names = dict(db.execute(select(User.id, User.name).where(User.id.in_({r.driver_id for r in rows}))).all()) if rows else {}
    plates = dict(db.execute(select(Vehicle.id, Vehicle.plate).where(Vehicle.id.in_({r.vehicle_id for r in rows}))).all()) if rows else {}
    return [
        FuelEntryOut(
            id=r.id, vehicle_id=r.vehicle_id, plate=plates.get(r.vehicle_id), driver_id=r.driver_id, driver_name=names.get(r.driver_id),
            run_id=r.run_id, filled_at=as_utc(r.filled_at), liters=r.liters, total=r.total_cents / 100,
            price_per_liter=round(r.total_cents / 100 / r.liters, 3), odometer_km=r.odometer_km, fuel_type=r.fuel_type,
            full_tank=r.full_tank, station=r.station,
        )
        for r in rows
    ]


def visible(db: Session, entry_id: int, user: User) -> FuelEntry:
    entry = db.get(FuelEntry, entry_id)
    if not entry or entry.company_id != user.company_id or (user.role == UserRole.driver and entry.driver_id != user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Abastecimento não encontrado.")
    return entry
