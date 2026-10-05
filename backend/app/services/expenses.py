"""Despesas da rota (pedágio, estacionamento, descarga…): o motorista registra com a foto do comprovante, o gestor
aprova e o valor entra como reembolso a receber, junto com o valor das rotas."""

from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import DeliveryRun, DriverPayment, RouteExpense, RunStatus, User, UserRole
from app.schemas.operations import ExpenseBrief, ExpenseOut
from app.services import uploads
from app.services.geo import as_utc

KIND_LABEL = {"toll": "Pedágio", "parking": "Estacionamento", "unloading": "Descarga (chapa)", "meal": "Alimentação", "other": "Outra"}


def _tz() -> ZoneInfo:
    return ZoneInfo(get_settings().timezone)


async def create(db: Session, driver: User, *, kind: str, amount: float, note: str | None, photo: UploadFile,
                 client_id: str | None, recorded_at: datetime | None) -> RouteExpense:
    if client_id and (done := db.scalar(select(RouteExpense).where(RouteExpense.client_id == client_id, RouteExpense.driver_id == driver.id))):
        return done  # reenvio (sem sinal) de uma despesa que já chegou
    spent_at = uploads.when_recorded(recorded_at)
    # Vale para a rota em andamento ou, sem ela, a última rota do dia
    run = db.scalar(select(DeliveryRun).where(DeliveryRun.driver_id == driver.id, DeliveryRun.status == RunStatus.active))
    if not run:
        today = spent_at.astimezone(_tz()).date()
        run = db.scalar(select(DeliveryRun).where(DeliveryRun.driver_id == driver.id, DeliveryRun.day == today)
                        .order_by(DeliveryRun.started_at.desc()).limit(1))
    expense = RouteExpense(
        company_id=driver.company_id, driver_id=driver.id, run_id=run.id if run else None, kind=kind,
        amount_cents=round(amount * 100), note=(note or "").strip() or None, status="pending", spent_at=spent_at,
        client_id=client_id, photo_path=await uploads.save_image(photo, "expenses", driver.company_id, "foto do comprovante"),
    )
    db.add(expense)
    db.commit()
    return expense


def review(db: Session, admin: User, expense: RouteExpense, approve: bool, reason: str | None) -> DriverPayment | None:
    """Aprovada, vira um reembolso a receber; recusada, fica no histórico com o motivo."""
    if expense.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "Essa despesa já foi analisada.")
    expense.reviewed_by, expense.reviewed_at = admin.id, datetime.now(timezone.utc)
    if not approve:
        if not (reason or "").strip():
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Diga por que a despesa foi recusada.")
        expense.status, expense.reject_reason = "rejected", reason.strip()
        db.commit()
        return None
    day = as_utc(expense.spent_at).astimezone(_tz()).strftime("%d/%m")
    payment = DriverPayment(
        company_id=expense.company_id, driver_id=expense.driver_id, amount_cents=expense.amount_cents,
        description=f"Reembolso · {KIND_LABEL[expense.kind]} · {day}", status="pending", created_by=admin.id,
    )
    db.add(payment)
    db.flush()
    expense.status, expense.payment_id = "approved", payment.id
    db.commit()
    return payment


def visible(db: Session, expense_id: int, user: User) -> RouteExpense:
    expense = db.get(RouteExpense, expense_id)
    if not expense or expense.company_id != user.company_id or (user.role == UserRole.driver and expense.driver_id != user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Despesa não encontrada.")
    return expense


def listing(db: Session, user: User, date_from: date, date_to: date, status_filter: str | None) -> list[RouteExpense]:
    start = datetime.combine(date_from, time.min, tzinfo=_tz())
    end = datetime.combine(date_to, time.max, tzinfo=_tz())
    q = select(RouteExpense).where(RouteExpense.company_id == user.company_id)
    # As que esperam análise aparecem sempre; as outras, do período
    q = q.where((RouteExpense.status == "pending") | RouteExpense.spent_at.between(start, end))
    if status_filter:
        q = q.where(RouteExpense.status == status_filter)
    if user.role == UserRole.driver:
        q = q.where(RouteExpense.driver_id == user.id)
    return list(db.scalars(q.order_by(RouteExpense.spent_at.desc())))


def brief(e: RouteExpense) -> ExpenseBrief:
    return ExpenseBrief(id=e.id, kind=e.kind, kind_label=KIND_LABEL[e.kind], amount=e.amount_cents / 100, status=e.status)


def out(db: Session, rows: list[RouteExpense]) -> list[ExpenseOut]:
    if not rows:
        return []
    names = dict(db.execute(select(User.id, User.name).where(User.id.in_({r.driver_id for r in rows}))).all())
    days = dict(db.execute(select(DeliveryRun.id, DeliveryRun.day).where(DeliveryRun.id.in_({r.run_id for r in rows if r.run_id}))).all())
    paid = dict(db.execute(select(DriverPayment.id, DriverPayment.status).where(DriverPayment.id.in_({r.payment_id for r in rows if r.payment_id}))).all())
    return [
        ExpenseOut(
            **brief(r).model_dump(), driver_id=r.driver_id, driver_name=names.get(r.driver_id), run_id=r.run_id,
            run_day=days.get(r.run_id), note=r.note, reject_reason=r.reject_reason, spent_at=as_utc(r.spent_at),
            reviewed_at=as_utc(r.reviewed_at) if r.reviewed_at else None, payment_status=paid.get(r.payment_id),
        )
        for r in rows
    ]
