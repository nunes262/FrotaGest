from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, HTTPException, status

from app.api.deps import AdminUser, CurrentUser, DbSession
from app.core.config import get_settings
from app.models import DeliveryRun, RunStatus
from app.schemas.payments import PaymentOut, PaymentOverview, PaymentPay
from app.services import payments, simulator

router = APIRouter(prefix="/payments", tags=["pagamentos"])

MAX_RANGE_DAYS = 366


def _today() -> date:
    return datetime.now(ZoneInfo(get_settings().timezone)).date()


def _notify(background: BackgroundTasks, events: list[tuple[list[int], dict]]) -> None:
    background.add_task(simulator.send, events)


@router.get("/overview", response_model=PaymentOverview)
def overview(db: DbSession, user: CurrentUser, date_from: date | None = None, date_to: date | None = None, driver_id: int | None = None):
    """Rotas do período com o valor de cada uma, os lançamentos e o saldo por motorista (a pagar e pago no período).
    Sem datas, vale o mês atual. O motorista vê só o dele."""
    date_to = date_to or _today()
    date_from = date_from or date_to.replace(day=1)
    if date_from > date_to or (date_to - date_from) > timedelta(days=MAX_RANGE_DAYS):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Escolha um período de até {MAX_RANGE_DAYS} dias, com o fim depois do início.")
    return payments.overview(db, user, date_from, date_to, driver_id)


@router.post("/pay", response_model=list[PaymentOut])
def pay(data: PaymentPay, db: DbSession, admin: AdminUser, background: BackgroundTasks):
    """Marca os lançamentos como pagos (na data informada ou hoje)."""
    paid = payments.pay(db, admin, data.payment_ids, data.paid_on or _today())
    _notify(background, payments.events(db, paid, "paid"))
    return payments.payment_rows(db, paid)


@router.post("/{payment_id}/unpay", response_model=PaymentOut)
def unpay(payment_id: int, db: DbSession, admin: AdminUser, background: BackgroundTasks):
    """Desfaz o pagamento (marcado por engano): volta a ficar a pagar."""
    payment = payments.unpay(db, admin, payment_id)
    _notify(background, payments.events(db, [payment], "unpaid"))
    return payments.payment_rows(db, [payment])[0]


@router.post("/runs/{run_id}/launch", response_model=PaymentOut, status_code=status.HTTP_201_CREATED)
def launch_run(run_id: int, db: DbSession, admin: AdminUser, background: BackgroundTasks):
    """Lança o preço da região de uma rota encerrada que ficou sem valor (por exemplo, encerrada sem entregas registradas)."""
    run = db.get(DeliveryRun, run_id)
    if not run or run.company_id != admin.company_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rota não encontrada.")
    if run.payment_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Essa rota já tem o valor lançado.")
    if run.status != RunStatus.finished:
        raise HTTPException(status.HTTP_409_CONFLICT, "O valor entra quando a rota é encerrada.")
    if run.region_price_cents is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A rota não caiu em nenhuma região da tabela. Confira a base da empresa e as regiões em Preço por região.",
        )
    payment = payments.launch_for_run(db, run, manual=True)
    _notify(background, payments.events(db, [payment], "created"))
    return payments.payment_rows(db, [payment])[0]
