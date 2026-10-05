"""Pagamento dos motoristas: cada rota vale o preço fixo da região dela (tabela por região), lançado quando a rota é
encerrada. O gestor marca quando pagou e o motorista vê o que tem a receber."""

from collections import Counter
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Delivery, DeliveryRun, DeliveryStatus, DriverPayment, RunStatus, User, UserRole, Vehicle
from app.schemas.payments import DriverBalance, PaymentOut, PaymentOverview, PaymentRun
from app.services import runs as run_service
from app.services.geo import as_utc


def reais(amount_cents: int) -> float:
    return amount_cents / 100


def _fmt_day(d: date) -> str:
    return d.strftime("%d/%m")


Carried = tuple[DeliveryStatus, float]  # status e peso


def _carried(db: Session, runs: list[DeliveryRun]) -> dict[int, list[Carried]]:
    """Entregas levadas em cada rota. Rotas antigas, sem o vínculo, ficam com as do dia do motorista."""
    by_run: dict[int, list[Carried]] = {r.id: [] for r in runs}
    for run_id, delivery_status, weight in db.execute(
        select(Delivery.run_id, Delivery.status, Delivery.weight_kg).where(Delivery.run_id.in_(by_run))
    ):
        by_run[run_id].append((delivery_status, weight))
    legacy = [r for r in runs if not by_run[r.id] and r.load_kg is None]
    if legacy:
        by_day: dict[tuple[int, date], list[Carried]] = {}
        q = select(Delivery.driver_id, Delivery.scheduled_for, Delivery.status, Delivery.weight_kg).where(
            Delivery.driver_id.in_({r.driver_id for r in legacy}), Delivery.scheduled_for.in_({r.day for r in legacy}),
            Delivery.run_id.is_(None),
        )
        for driver_id, day, delivery_status, weight in db.execute(q):
            by_day.setdefault((driver_id, day), []).append((delivery_status, weight))
        for r in legacy:
            by_run[r.id] = by_day.get((r.driver_id, r.day), [])
    return by_run


def run_rows(db: Session, runs: list[DeliveryRun]) -> list[PaymentRun]:
    """Rotas com motorista, placa, km, peso e quantas entregas foram feitas."""
    if not runs:
        return []
    names = dict(db.execute(select(User.id, User.name).where(User.id.in_({r.driver_id for r in runs}))).all())
    plates = dict(db.execute(select(Vehicle.id, Vehicle.plate).where(Vehicle.id.in_({r.vehicle_id for r in runs}))).all())
    carried = _carried(db, runs)
    out = []
    for r in runs:
        items = carried[r.id]
        c = Counter(s for s, _ in items)
        out.append(PaymentRun(
            id=r.id, day=r.day, driver_id=r.driver_id, driver_name=names.get(r.driver_id), plate=plates.get(r.vehicle_id),
            status=r.status, started_at=as_utc(r.started_at), finished_at=as_utc(r.finished_at) if r.finished_at else None,
            distance_km=round(run_service.run_km(db, r), 1), deliveries=len(items),
            delivered=c[DeliveryStatus.delivered], failed=c[DeliveryStatus.failed],
            load_kg=round(r.load_kg if r.load_kg is not None else sum(w for _, w in items), 1),
            delivered_kg=round(sum(w for s, w in items if s == DeliveryStatus.delivered), 1),
            region_name=r.region_name, region_price=reais(r.region_price_cents) if r.region_price_cents is not None else None,
            payment_id=r.payment_id,
        ))
    return out


def payment_rows(db: Session, payments: list[DriverPayment]) -> list[PaymentOut]:
    if not payments:
        return []
    names = dict(db.execute(select(User.id, User.name).where(User.id.in_({p.driver_id for p in payments}))).all())
    linked = list(db.scalars(
        select(DeliveryRun).where(DeliveryRun.payment_id.in_([p.id for p in payments])).order_by(DeliveryRun.day, DeliveryRun.started_at)
    ))
    by_payment: dict[int, list[PaymentRun]] = {}
    for row in run_rows(db, linked):
        by_payment.setdefault(row.payment_id, []).append(row)
    return [
        PaymentOut(
            id=p.id, driver_id=p.driver_id, driver_name=names.get(p.driver_id), amount=reais(p.amount_cents),
            description=p.description, status=p.status, paid_on=p.paid_on, created_at=as_utc(p.created_at),
            runs=by_payment.get(p.id, []),
        )
        for p in payments
    ]


def overview(db: Session, user: User, date_from: date, date_to: date, driver_id: int | None) -> PaymentOverview:
    """Rotas do período, lançamentos (a pagar, pagos no período e os das rotas do período) e o saldo de cada motorista."""
    if user.role == UserRole.driver:
        driver_id = user.id  # o motorista só vê o dele
    rq = select(DeliveryRun).where(DeliveryRun.company_id == user.company_id, DeliveryRun.day.between(date_from, date_to))
    if driver_id:
        rq = rq.where(DeliveryRun.driver_id == driver_id)
    period_runs = list(db.scalars(rq.order_by(DeliveryRun.day.desc(), DeliveryRun.started_at.desc())))

    pq = select(DriverPayment).where(
        DriverPayment.company_id == user.company_id,
        or_(
            DriverPayment.status == "pending",
            DriverPayment.paid_on.between(date_from, date_to),
            DriverPayment.id.in_([r.payment_id for r in period_runs if r.payment_id]),
        ),
    )
    if driver_id:
        pq = pq.where(DriverPayment.driver_id == driver_id)
    payments = list(db.scalars(pq.order_by(DriverPayment.created_at.desc(), DriverPayment.id.desc())))
    # A pagar primeiro
    payments.sort(key=lambda p: p.status != "pending")

    driver_ids = {r.driver_id for r in period_runs} | {p.driver_id for p in payments}
    if user.role == UserRole.driver:
        driver_ids = {user.id}
    drivers = {u.id: u for u in db.scalars(select(User).where(User.id.in_(driver_ids)))}
    balances = []
    for d_id in driver_ids:
        pending = [p for p in payments if p.driver_id == d_id and p.status == "pending"]
        paid = [p for p in payments if p.driver_id == d_id and p.status == "paid" and p.paid_on and date_from <= p.paid_on <= date_to]
        driver = drivers.get(d_id)
        balances.append(DriverBalance(
            driver_id=d_id, driver_name=driver.name if driver else None, active=bool(driver and driver.active),
            pending_amount=reais(sum(p.amount_cents for p in pending)), pending_count=len(pending),
            paid_amount=reais(sum(p.amount_cents for p in paid)), paid_count=len(paid),
            unpriced_runs=sum(1 for r in period_runs if r.driver_id == d_id and r.status == RunStatus.finished and not r.payment_id),
        ))
    balances.sort(key=lambda b: (-b.pending_amount, b.driver_name or ""))
    return PaymentOverview(balances=balances, runs=run_rows(db, period_runs), payments=payment_rows(db, payments))


def _company_payment(db: Session, payment_id: int, admin: User) -> DriverPayment:
    payment = db.get(DriverPayment, payment_id)
    if not payment or payment.company_id != admin.company_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lançamento não encontrado.")
    return payment


def _pending(payment: DriverPayment) -> DriverPayment:
    if payment.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "Esse lançamento já foi pago.")
    return payment


def pay(db: Session, admin: User, payment_ids: list[int], paid_on: date) -> list[DriverPayment]:
    payments = [_company_payment(db, i, admin) for i in dict.fromkeys(payment_ids)]
    for p in payments:
        _pending(p)
    for p in payments:
        p.status, p.paid_on = "paid", paid_on
    db.commit()
    return payments


def unpay(db: Session, admin: User, payment_id: int) -> DriverPayment:
    payment = _company_payment(db, payment_id, admin)
    if payment.status != "paid":
        raise HTTPException(status.HTTP_409_CONFLICT, "Esse lançamento ainda não foi pago.")
    payment.status, payment.paid_on = "pending", None
    db.commit()
    return payment


def launch_for_run(db: Session, run: DeliveryRun, manual: bool = False) -> DriverPayment | None:
    """O valor da rota é sempre o preço da região dela. Lança sozinho quando a rota é encerrada com entregas resolvidas;
    a rota encerrada sem nenhuma (teste, desistência) só é lançada se o gestor pedir (manual)."""
    if run.region_price_cents is None or run.payment_id or run.status != RunStatus.finished:
        return None
    resolved = db.scalar(select(func.count()).where(Delivery.run_id == run.id, Delivery.status.in_(run_service.DONE)))
    if not resolved and not manual:
        return None
    payment = DriverPayment(
        company_id=run.company_id, driver_id=run.driver_id, amount_cents=run.region_price_cents,
        description=f"Rota de {_fmt_day(run.day)} · {run.region_name}", status="pending",
    )
    db.add(payment)
    db.flush()
    run.payment_id = payment.id
    db.commit()
    return payment


def drop_empty(db: Session, payment_ids: set[int]) -> None:
    """Depois de apagar rotas (teste recomeçado): os lançamentos a pagar que ficaram sem nenhuma rota somem."""
    for payment_id in payment_ids:
        payment = db.get(DriverPayment, payment_id)
        has_runs = db.scalar(select(func.count()).where(DeliveryRun.payment_id == payment_id))
        if payment and payment.status == "pending" and not has_runs:
            db.delete(payment)


def events(db: Session, payments: list[DriverPayment], kind: str) -> list[tuple[list[int], dict]]:
    """Avisos pelo WebSocket: o motorista vê o valor novo ou o pagamento na hora; os gestores atualizam a tela."""
    by_driver: dict[int, list[DriverPayment]] = {}
    for p in payments:
        by_driver.setdefault(p.driver_id, []).append(p)
    out: list[tuple[list[int], dict]] = []
    for driver_id, items in by_driver.items():
        data = {"kind": kind, "amount": reais(sum(p.amount_cents for p in items)), "count": len(items)}
        out.append(([driver_id], {"type": "payments_changed", "data": data}))
    if payments:
        out.append((run_service.admin_ids(db, payments[0].company_id), {"type": "payments_changed", "data": None}))
    return out
