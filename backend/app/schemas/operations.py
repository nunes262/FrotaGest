"""Rotina do motorista em volta da rota: checklist de saída, abastecimento, despesas e notificações."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

ExpenseKind = Literal["toll", "parking", "unloading", "meal", "other"]
ExpenseStatus = Literal["pending", "approved", "rejected"]


class ChecklistItemDef(BaseModel):
    key: str
    label: str


class ChecklistItemOut(BaseModel):
    key: str
    label: str
    ok: bool
    note: str | None
    has_photo: bool


class ChecklistBrief(BaseModel):
    id: int
    issues: int


class ChecklistOut(ChecklistBrief):
    driver_id: int
    driver_name: str | None
    vehicle_id: int
    plate: str | None
    run_id: int | None
    odometer_km: float | None
    created_at: datetime
    items: list[ChecklistItemOut]


class FuelEntryOut(BaseModel):
    id: int
    vehicle_id: int
    plate: str | None
    driver_id: int
    driver_name: str | None
    run_id: int | None
    filled_at: datetime
    liters: float
    total: float
    price_per_liter: float
    odometer_km: float | None
    fuel_type: str
    full_tank: bool
    station: str | None


class ExpenseBrief(BaseModel):
    id: int
    kind: ExpenseKind
    kind_label: str
    amount: float
    status: ExpenseStatus


class ExpenseOut(ExpenseBrief):
    driver_id: int
    driver_name: str | None
    run_id: int | None
    run_day: date | None
    note: str | None
    reject_reason: str | None
    spent_at: datetime
    reviewed_at: datetime | None
    # Reembolso aprovado: a receber ou já pago
    payment_status: Literal["pending", "paid"] | None


class ExpenseReview(BaseModel):
    approve: bool
    reason: str | None = Field(default=None, max_length=200)


class PushSubscriptionIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=600)
    keys: dict[str, str]


class PushUnsubscribe(BaseModel):
    endpoint: str = Field(min_length=10, max_length=600)
