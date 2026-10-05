from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import AdminUser, CurrentUser, DbSession
from app.models import Tire, TireEvent, User, UserRole, Vehicle
from app.schemas.tires import (
    POSITIONS_BY_LAYOUT,
    TIRE_POSITIONS,
    TireCreate,
    TireEventOut,
    TireOut,
    TireRetread,
    TireRotate,
    TireUpdate,
)
from app.services.geo import as_utc
from app.services.runs import mm_to_pct, tire_out, vehicle_route_km

router = APIRouter(tags=["pneus"])

TAKEN = "Essa posição do veículo já tem um pneu."
OPTIONAL_TEXT = {"brand", "identification"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _company_vehicle(db: Session, vehicle_id: int, user: User) -> Vehicle:
    vehicle = db.get(Vehicle, vehicle_id)
    if not vehicle or vehicle.company_id != user.company_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Veículo não encontrado.")
    return vehicle


def _visible_tire(db: Session, tire_id: int, user: User) -> Tire:
    """Gestor: qualquer pneu da empresa. Motorista: só os do veículo dele."""
    tire = db.get(Tire, tire_id)
    if not tire or tire.company_id != user.company_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pneu não encontrado.")
    if user.role == UserRole.driver and db.get(Vehicle, tire.vehicle_id).current_driver_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pneu não encontrado.")
    return tire


def _check_position(vehicle: Vehicle, position: str) -> None:
    """A posição precisa existir no rodado do veículo (van de rodado simples não tem pneu interno)."""
    layout = vehicle.axle_layout or "dual"
    if position not in POSITIONS_BY_LAYOUT[layout]:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Esse veículo tem rodado traseiro simples: use traseiro esquerdo ou direito."
            if layout == "single"
            else "Esse veículo tem rodado traseiro duplo: escolha o pneu externo ou interno.",
        )


def _measured_pct(measured_pct: float | None, measured_mm: float | None, tread_new_mm: float | None) -> float | None:
    """A medição pode vir em % ou em mm (convertida pelo sulco do pneu novo)."""
    if measured_mm is None:
        return measured_pct
    if not tread_new_mm:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Para medir em mm, informe o sulco do pneu novo.")
    return round(mm_to_pct(measured_mm, tread_new_mm), 1)


def _event(db: Session, tire: Tire, kind: str, km: float, **fields) -> None:
    db.add(TireEvent(tire_id=tire.id, company_id=tire.company_id, kind=kind, happened_at=_now(), vehicle_km=km, **fields))


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, TAKEN)


@router.get("/tires", response_model=list[TireOut])
def list_tires(db: DbSession, user: CurrentUser, vehicle_id: int | None = None):
    """Pneus com o desgaste estimado. O gestor vê os da frota; o motorista, os do veículo dele."""
    q = select(Tire).join(Vehicle, Vehicle.id == Tire.vehicle_id).where(Tire.company_id == user.company_id)
    if user.role == UserRole.driver:
        q = q.where(Vehicle.current_driver_id == user.id)
    if vehicle_id:
        q = q.where(Tire.vehicle_id == vehicle_id)
    tires = db.scalars(q).all()
    km = {vid: vehicle_route_km(db, vid) for vid in {t.vehicle_id for t in tires}}
    ordered = sorted(tires, key=lambda t: (t.vehicle_id, TIRE_POSITIONS.index(t.position)))
    return [tire_out(t, km[t.vehicle_id]) for t in ordered]


@router.get("/tires/{tire_id}/events", response_model=list[TireEventOut])
def tire_events(tire_id: int, db: DbSession, user: CurrentUser):
    """Histórico do pneu, do mais recente para o mais antigo."""
    tire = _visible_tire(db, tire_id, user)
    events = db.scalars(select(TireEvent).where(TireEvent.tire_id == tire.id).order_by(TireEvent.id.desc()))
    return [TireEventOut.model_validate(e).model_copy(update={"happened_at": as_utc(e.happened_at)}) for e in events]


@router.post("/vehicles/{vehicle_id}/tires", response_model=TireOut, status_code=status.HTTP_201_CREATED)
def create_tire(vehicle_id: int, data: TireCreate, db: DbSession, admin: AdminUser):
    """Monta um pneu no veículo com a porcentagem de banda medida agora (e o preço, para o custo por km)."""
    vehicle = _company_vehicle(db, vehicle_id, admin)
    _check_position(vehicle, data.position)
    pct = _measured_pct(data.measured_pct, data.measured_mm, data.tread_new_mm)
    if pct is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Informe quanto resta da banda (%) ou o sulco medido (mm).")
    km = vehicle_route_km(db, vehicle.id)
    tire = Tire(
        company_id=admin.company_id, vehicle_id=vehicle.id, measured_at=_now(), km_at_measure=km, km_at_mount=km,
        retreads=0, measured_pct=pct, **data.model_dump(exclude=OPTIONAL_TEXT | {"measured_pct", "measured_mm"}),
        brand=(data.brand or "").strip() or None, identification=(data.identification or "").strip() or None,
    )
    db.add(tire)
    _commit(db)
    _event(db, tire, "mount", km, measured_pct=tire.measured_pct, cost=tire.cost,
           detail=f"{data.measured_mm:g} mm" if data.measured_mm is not None else None)
    db.commit()
    return tire_out(tire, km)


@router.patch("/tires/{tire_id}", response_model=TireOut)
def update_tire(tire_id: int, data: TireUpdate, db: DbSession, admin: AdminUser):
    """Mudar a porcentagem registra uma nova medição: o desgaste volta a ser contado a partir de agora."""
    tire = _visible_tire(db, tire_id, admin)
    km = vehicle_route_km(db, tire.vehicle_id)
    # Marca e identificação podem ser apagadas; os demais campos nulos são "não mudar"
    changes = {f: v for f, v in data.model_dump(exclude_unset=True).items() if v is not None or f in OPTIONAL_TEXT}
    for field in OPTIONAL_TEXT & changes.keys():
        changes[field] = (changes[field] or "").strip() or None
    if "position" in changes and changes["position"] != tire.position:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Para mudar o pneu de posição, use o rodízio.")
    changes.pop("position", None)
    measured_mm = changes.pop("measured_mm", None)
    if measured_mm is not None:
        changes["measured_pct"] = _measured_pct(None, measured_mm, changes.get("tread_new_mm", tire.tread_new_mm))
    if "measured_pct" in changes:
        changes |= {"measured_at": _now(), "km_at_measure": km}
        _event(db, tire, "measure", km, measured_pct=changes["measured_pct"],
               detail=f"{measured_mm:g} mm" if measured_mm is not None else None)
    for field, value in changes.items():
        setattr(tire, field, value)
    _commit(db)
    return tire_out(tire, km)


@router.post("/tires/{tire_id}/rotate", response_model=list[TireOut])
def rotate_tire(tire_id: int, data: TireRotate, db: DbSession, admin: AdminUser):
    """Rodízio: muda o pneu de posição. Se a posição tem outro pneu, os dois trocam de lugar."""
    tire = _visible_tire(db, tire_id, admin)
    if data.position == tire.position:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Escolha uma posição diferente da atual.")
    _check_position(db.get(Vehicle, tire.vehicle_id), data.position)
    km = vehicle_route_km(db, tire.vehicle_id)
    other = db.scalar(select(Tire).where(Tire.vehicle_id == tire.vehicle_id, Tire.position == data.position))
    old = tire.position
    # A posição é única por veículo: libera a de origem antes de trocar
    tire.position = "TMP"
    db.flush()
    if other:
        other.position = old
        db.flush()
        _event(db, other, "rotation", km, detail=f"{data.position} → {old}")
    tire.position = data.position
    _event(db, tire, "rotation", km, detail=f"{old} → {data.position}")
    _commit(db)
    return [tire_out(t, km) for t in (tire, other) if t]


@router.post("/tires/{tire_id}/retread", response_model=TireOut)
def retread_tire(tire_id: int, data: TireRetread, db: DbSession, admin: AdminUser):
    """Recapagem: a banda volta (normalmente a 100%) e o custo entra no histórico."""
    tire = _visible_tire(db, tire_id, admin)
    km = vehicle_route_km(db, tire.vehicle_id)
    tire.retreads = (tire.retreads or 0) + 1
    tire.measured_pct, tire.measured_at, tire.km_at_measure = data.measured_pct, _now(), km
    if data.life_km:
        tire.life_km = data.life_km
    _event(db, tire, "retread", km, measured_pct=data.measured_pct, cost=data.cost, detail=f"{tire.retreads}ª recapagem")
    db.commit()
    return tire_out(tire, km)


@router.delete("/tires/{tire_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tire(tire_id: int, db: DbSession, admin: AdminUser):
    tire = _visible_tire(db, tire_id, admin)
    db.execute(delete(TireEvent).where(TireEvent.tire_id == tire.id))
    db.delete(tire)
    db.commit()
