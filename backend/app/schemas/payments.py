from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models import RunStatus

PaymentStatus = Literal["pending", "paid"]


class PaymentPay(BaseModel):
    payment_ids: list[int] = Field(min_length=1, max_length=500)
    paid_on: date | None = None  # hoje, se não informado


class PaymentRun(BaseModel):
    """Rota de entrega com o que é preciso para dar o valor: km e entregas."""

    id: int
    day: date
    driver_id: int
    driver_name: str | None
    plate: str | None
    status: RunStatus
    started_at: datetime
    finished_at: datetime | None
    distance_km: float
    deliveries: int
    delivered: int
    failed: int
    load_kg: float  # peso carregado na rota
    delivered_kg: float  # peso entregue
    region_name: str | None  # região de preço da rota
    region_price: float | None  # preço fixo da rota pela tabela
    payment_id: int | None


class PaymentOut(BaseModel):
    id: int
    driver_id: int
    driver_name: str | None
    amount: float
    description: str | None
    status: PaymentStatus
    paid_on: date | None
    created_at: datetime
    runs: list[PaymentRun]  # vazio se as rotas foram apagadas depois


class DriverBalance(BaseModel):
    driver_id: int
    driver_name: str | None
    active: bool
    pending_amount: float  # a pagar (de qualquer data)
    pending_count: int
    paid_amount: float  # pago no período
    paid_count: int
    unpriced_runs: int  # rotas encerradas no período ainda sem valor


class PaymentOverview(BaseModel):
    balances: list[DriverBalance]
    runs: list[PaymentRun]  # rotas do período
    payments: list[PaymentOut]  # a pagar, pagos no período e os das rotas do período
