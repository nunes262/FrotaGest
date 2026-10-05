"""Rotina do motorista em volta da rota: checklist de saída, abastecimento, despesas e notificações."""

from datetime import date, datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Query, Request, UploadFile, status
from sqlalchemy import delete, select

from app.api.deps import AdminUser, CurrentUser, DbSession, DriverUser
from app.core.config import get_settings
from app.models import PushSubscription
from app.schemas.operations import (
    ChecklistItemDef,
    ChecklistOut,
    ExpenseKind,
    ExpenseOut,
    ExpenseReview,
    FuelEntryOut,
    PushSubscriptionIn,
    PushUnsubscribe,
)
from app.services import checklists, expenses, notify, push, refuels, runs, uploads


def _today() -> date:
    return datetime.now(ZoneInfo(get_settings().timezone)).date()


def _period(date_from: date | None, date_to: date | None, default_days: int = 30) -> tuple[date, date]:
    date_to = date_to or _today()
    date_from = date_from or date_to - timedelta(days=default_days - 1)
    if date_from > date_to or (date_to - date_from).days > 366:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Escolha um período de até 366 dias, com o fim depois do início.")
    return date_from, date_to


# ---------- checklist de saída ----------

checklist_router = APIRouter(prefix="/checklists", tags=["checklist de saída"])


@checklist_router.get("/items", response_model=list[ChecklistItemDef])
def checklist_items(user: CurrentUser):
    """Itens que o motorista confere antes de sair."""
    return checklists.item_defs()


@checklist_router.post("", response_model=ChecklistOut, status_code=status.HTTP_201_CREATED)
async def create_checklist(request: Request, db: DbSession, driver: DriverUser):
    """Checklist antes de sair (multipart): "items" em JSON [{key, ok, note}], "odometer_km" e uma foto por item com
    problema ("photo_<key>"). O id vai junto ao iniciar a rota."""
    checklist = await checklists.create(db, driver, await request.form())
    return checklists.out(db, checklist)


@checklist_router.get("/{checklist_id}", response_model=ChecklistOut)
def get_checklist(checklist_id: int, db: DbSession, user: CurrentUser):
    return checklists.out(db, checklists.visible(db, checklist_id, user))


@checklist_router.get("/{checklist_id}/photos/{key}")
def checklist_photo(checklist_id: int, key: str, db: DbSession, user: CurrentUser):
    return uploads.file_response(checklists.photo_path(checklists.visible(db, checklist_id, user), key), "Esse item não tem foto.")


# ---------- abastecimento ----------

fuel_router = APIRouter(prefix="/fuel-entries", tags=["abastecimento"])


@fuel_router.post("", response_model=FuelEntryOut, status_code=status.HTTP_201_CREATED)
async def create_fuel_entry(
    db: DbSession,
    driver: DriverUser,
    liters: Annotated[float, Form(gt=0, le=1000)],
    total: Annotated[float, Form(gt=0, le=20000)],
    photo: Annotated[UploadFile, File(description="Foto do cupom")],
    odometer_km: Annotated[float | None, Form(ge=0, le=5_000_000)] = None,
    fuel_type: Annotated[str | None, Form(pattern="^(diesel|gasolina)$")] = None,
    full_tank: Annotated[bool, Form()] = True,
    station: Annotated[str | None, Form(max_length=120)] = None,
    latitude: Annotated[float | None, Form(ge=-90, le=90)] = None,
    longitude: Annotated[float | None, Form(ge=-180, le=180)] = None,
    client_id: Annotated[str | None, Form(max_length=36)] = None,
    recorded_at: Annotated[datetime | None, Form()] = None,
):
    """O motorista registra o abastecimento com a foto do cupom (feito sem sinal, chega depois com o mesmo client_id)."""
    entry = await refuels.create(
        db, driver, liters=liters, total=total, odometer_km=odometer_km, fuel_type=fuel_type, full_tank=full_tank,
        station=station, photo=photo, latitude=latitude, longitude=longitude, client_id=client_id, recorded_at=recorded_at,
    )
    return refuels.out(db, [entry])[0]


@fuel_router.get("", response_model=list[FuelEntryOut])
def list_fuel_entries(db: DbSession, user: CurrentUser, date_from: date | None = None, date_to: date | None = None,
                      vehicle_id: int | None = None):
    """Abastecimentos do período (sem datas, os últimos 30 dias). O motorista vê os dele."""
    start, end = _period(date_from, date_to)
    return refuels.out(db, refuels.entries(db, user, start, end, vehicle_id))


@fuel_router.get("/{entry_id}/photo")
def fuel_photo(entry_id: int, db: DbSession, user: CurrentUser):
    return uploads.file_response(refuels.visible(db, entry_id, user).photo_path, "Esse abastecimento não tem foto.")


# ---------- despesas ----------

expense_router = APIRouter(prefix="/expenses", tags=["despesas da rota"])


@expense_router.post("", response_model=ExpenseOut, status_code=status.HTTP_201_CREATED)
async def create_expense(
    db: DbSession,
    driver: DriverUser,
    background: BackgroundTasks,
    kind: Annotated[ExpenseKind, Form()],
    amount: Annotated[float, Form(gt=0, le=5000)],
    photo: Annotated[UploadFile, File(description="Foto do comprovante")],
    note: Annotated[str | None, Form(max_length=300)] = None,
    client_id: Annotated[str | None, Form(max_length=36)] = None,
    recorded_at: Annotated[datetime | None, Form()] = None,
):
    """Despesa paga na rota (pedágio, estacionamento, descarga…), com o comprovante. O gestor recebe para aprovar."""
    expense = await expenses.create(db, driver, kind=kind, amount=amount, note=note, photo=photo, client_id=client_id,
                                    recorded_at=recorded_at)
    data = {"id": expense.id, "driver_name": driver.name, "kind_label": expenses.KIND_LABEL[expense.kind], "amount": amount}
    background.add_task(notify.send, [(runs.admin_ids(db, driver.company_id), {"type": "expense_submitted", "data": data})])
    return expenses.out(db, [expense])[0]


@expense_router.get("", response_model=list[ExpenseOut])
def list_expenses(db: DbSession, user: CurrentUser, date_from: date | None = None, date_to: date | None = None,
                  status_filter: Annotated[str | None, Query(alias="status", pattern="^(pending|approved|rejected)$")] = None):
    """Despesas do período (sem datas, os últimos 30 dias) e todas as que esperam análise. O motorista vê as dele."""
    start, end = _period(date_from, date_to)
    return expenses.out(db, expenses.listing(db, user, start, end, status_filter))


@expense_router.post("/{expense_id}/review", response_model=ExpenseOut)
def review_expense(expense_id: int, data: ExpenseReview, db: DbSession, admin: AdminUser, background: BackgroundTasks):
    """Aprovar (vira reembolso a receber) ou recusar com o motivo. O motorista é avisado."""
    from app.services import payments  # evita import circular

    expense = expenses.visible(db, expense_id, admin)
    payment = expenses.review(db, admin, expense, data.approve, data.reason)
    events = [([expense.driver_id], {"type": "expense_reviewed", "data": {
        "id": expense.id, "approved": data.approve, "amount": expense.amount_cents / 100,
        "kind_label": expenses.KIND_LABEL[expense.kind], "reason": expense.reject_reason,
    }})]
    if payment:
        events += [e for e in payments.events(db, [payment], "updated")]  # só atualiza as telas (sem segunda notificação)
    background.add_task(notify.send, events)
    return expenses.out(db, [expense])[0]


@expense_router.get("/{expense_id}/photo")
def expense_photo(expense_id: int, db: DbSession, user: CurrentUser):
    return uploads.file_response(expenses.visible(db, expense_id, user).photo_path, "Essa despesa não tem foto.")


# ---------- notificações (Web Push) ----------

push_router = APIRouter(prefix="/push", tags=["notificações"])


@push_router.get("/public-key")
def push_public_key(user: CurrentUser):
    """Chave do servidor para o navegador se inscrever."""
    return {"key": push.public_key()}


@push_router.post("/subscriptions", status_code=status.HTTP_204_NO_CONTENT)
def subscribe(data: PushSubscriptionIn, request: Request, db: DbSession, user: CurrentUser):
    """Este aparelho passa a receber as notificações do usuário (troca de dono se outro usuário entrar nele)."""
    if not data.keys.get("p256dh") or not data.keys.get("auth"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Inscrição incompleta.")
    row = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == data.endpoint)) or PushSubscription(endpoint=data.endpoint)
    row.user_id, row.p256dh, row.auth = user.id, data.keys["p256dh"], data.keys["auth"]
    row.user_agent = (request.headers.get("user-agent") or "")[:200]
    db.add(row)
    db.commit()


@push_router.post("/subscriptions/remove", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(data: PushUnsubscribe, db: DbSession, user: CurrentUser):
    db.execute(delete(PushSubscription).where(PushSubscription.endpoint == data.endpoint, PushSubscription.user_id == user.id))
    db.commit()


@push_router.get("/subscriptions/me")
def my_subscriptions(db: DbSession, user: CurrentUser):
    """Quantos aparelhos do usuário estão inscritos."""
    return {"devices": len(db.scalars(select(PushSubscription.id).where(PushSubscription.user_id == user.id)).all())}


routers = [checklist_router, fuel_router, expense_router, push_router]
