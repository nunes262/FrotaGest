"""Checklist antes de sair: o motorista confere o veículo e a carga; o que tiver problema vai com observação e foto."""

import json
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.datastructures import FormData, UploadFile

from app.models import DeliveryRun, User, Vehicle, VehicleChecklist
from app.schemas.operations import ChecklistBrief, ChecklistItemDef, ChecklistItemOut, ChecklistOut
from app.services import uploads
from app.services.geo import as_utc

ITEMS = (
    ("tires", "Pneus calibrados e sem avarias"),
    ("lights", "Faróis, setas e luz de freio"),
    ("brakes", "Freios"),
    ("fluids", "Óleo, água e combustível"),
    ("mirrors", "Retrovisores, vidros e limpador"),
    ("documents", "Documento do veículo e CNH"),
    ("safety", "Extintor, triângulo, macaco e estepe"),
    ("cargo", "Carga conferida e bem acomodada"),
)
LABELS = dict(ITEMS)
# O checklist vale para a rota que sai logo depois dele
VALID_FOR = timedelta(hours=3)


def item_defs() -> list[ChecklistItemDef]:
    return [ChecklistItemDef(key=k, label=label) for k, label in ITEMS]


def _vehicle_of(db: Session, driver: User) -> Vehicle:
    vehicle = db.scalar(select(Vehicle).where(Vehicle.current_driver_id == driver.id).order_by(Vehicle.id).limit(1))
    if not vehicle:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cadastre seu veículo em “Meu veículo” antes de sair.")
    return vehicle


async def create(db: Session, driver: User, form: FormData) -> VehicleChecklist:
    vehicle = _vehicle_of(db, driver)
    try:
        answers = {a["key"]: a for a in json.loads(form.get("items") or "[]")}
    except (ValueError, TypeError, KeyError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Checklist inválido.")
    if set(answers) != set(LABELS):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Responda todos os itens do checklist.")
    items = []
    for key, label in ITEMS:
        ok = bool(answers[key].get("ok"))
        note = (answers[key].get("note") or "").strip()[:300] or None
        if not ok and not note:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Conte qual é o problema em “{label}”.")
        photo = form.get(f"photo_{key}")
        path = await uploads.save_image(photo, "checklists", driver.company_id) if isinstance(photo, UploadFile) and photo.filename else None
        items.append({"key": key, "ok": ok, "note": note, "photo": path})
    odometer = form.get("odometer_km")
    try:
        odometer = float(odometer) if odometer not in (None, "") else None
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Hodômetro inválido.")
    checklist = VehicleChecklist(
        company_id=driver.company_id, driver_id=driver.id, vehicle_id=vehicle.id, odometer_km=odometer,
        items=items, issues=sum(1 for i in items if not i["ok"]),
    )
    db.add(checklist)
    db.commit()
    return checklist


def attach(db: Session, run: DeliveryRun, checklist_id: int, driver: User) -> VehicleChecklist:
    """Liga o checklist recém-feito à rota que está saindo."""
    checklist = db.get(VehicleChecklist, checklist_id)
    fresh = checklist and datetime.now(timezone.utc) - as_utc(checklist.created_at) <= VALID_FOR
    if not checklist or checklist.driver_id != driver.id or checklist.run_id or not fresh:
        raise HTTPException(status.HTTP_409_CONFLICT, "Faça o checklist de novo antes de sair.")
    checklist.run_id = run.id
    return checklist


def brief(db: Session, run_id: int) -> ChecklistBrief | None:
    row = db.execute(select(VehicleChecklist.id, VehicleChecklist.issues).where(VehicleChecklist.run_id == run_id)).first()
    return ChecklistBrief(id=row[0], issues=row[1]) if row else None


def visible(db: Session, checklist_id: int, user: User) -> VehicleChecklist:
    checklist = db.get(VehicleChecklist, checklist_id)
    if not checklist or checklist.company_id != user.company_id or (user.role.value == "driver" and checklist.driver_id != user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Checklist não encontrado.")
    return checklist


def out(db: Session, c: VehicleChecklist) -> ChecklistOut:
    driver = db.get(User, c.driver_id)
    vehicle = db.get(Vehicle, c.vehicle_id)
    return ChecklistOut(
        id=c.id, issues=c.issues, driver_id=c.driver_id, driver_name=driver.name if driver else None,
        vehicle_id=c.vehicle_id, plate=vehicle.plate if vehicle else None, run_id=c.run_id, odometer_km=c.odometer_km,
        created_at=as_utc(c.created_at),
        items=[ChecklistItemOut(key=i["key"], label=LABELS.get(i["key"], i["key"]), ok=i["ok"], note=i.get("note"),
                                has_photo=bool(i.get("photo"))) for i in c.items],
    )


def photo_path(c: VehicleChecklist, key: str) -> str | None:
    return next((i.get("photo") for i in c.items if i["key"] == key), None)


def photos(c: VehicleChecklist) -> list[str]:
    return [i["photo"] for i in c.items if i.get("photo")]
