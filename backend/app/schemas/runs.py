from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models import RunStatus
from app.schemas.deliveries import DeliveryOut
from app.schemas.operations import ChecklistBrief, ExpenseBrief
from app.schemas.tires import TireOut


PauseKind = Literal["meal", "rest", "wait"]


class RunStart(BaseModel):
    day: date
    checklist_id: int | None = None  # checklist de saída feito logo antes


class PauseStart(BaseModel):
    kind: PauseKind


class PauseOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    kind: PauseKind
    started_at: datetime
    ended_at: datetime | None


class RunPointIn(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0)
    recorded_at: datetime


class RunPointsIn(BaseModel):
    points: list[RunPointIn] = Field(min_length=1, max_length=500)


class RunStop(BaseModel):
    order: int
    delivery: DeliveryOut
    latitude: float | None
    longitude: float | None
    # "address" (pelo número), "street" (só a rua), "city" (centro da cidade); nulo = não localizada
    precision: str | None
    leg_km: float | None  # do ponto anterior até esta parada
    # False para entregas que chegaram depois do cálculo da rota
    planned: bool


class RunSummary(BaseModel):
    id: int
    driver_id: int
    vehicle_id: int
    day: date
    status: RunStatus
    started_at: datetime
    finished_at: datetime | None
    planned_distance_km: float | None
    distance_km: float  # rodados até agora (ou no total, se encerrada)
    km_source: Literal["tracker", "phone"] | None
    active_pause: PauseOut | None
    load_kg: float | None  # peso carregado nesta rota
    # Região de preço e o preço fixo da rota (tabela por região)
    region_name: str | None
    region_price: float | None
    checklist: ChecklistBrief | None  # checklist de saída (nulo = saiu sem checklist)


class RunOut(RunSummary):
    plate: str
    origin: tuple[float, float] | None
    returns_to_base: bool
    return_km: float | None
    planned_duration_min: int | None
    optimized: bool
    geometry: list[tuple[float, float]]
    stops: list[RunStop]
    # Caminho percorrido (rastreador ou celular) e a última posição conhecida
    trail: list[tuple[float, float]]
    current_position: tuple[float, float] | None
    position_at: datetime | None
    # O carregamento mudou depois do cálculo (entrega nova ou retirada)
    needs_replan: bool
    # Posição vinda do rastreador simulado (opções de desenvolvedor): o app ignora o GPS do celular
    simulated: bool
    pauses: list[PauseOut]
    # Desgaste estimado dos pneus nesta rota (média dos que estão rodando) e o pneu mais gasto
    tire_wear_pct: float | None
    worst_tire: TireOut | None


class RunPayment(BaseModel):
    amount: float
    status: Literal["pending", "paid"]
    paid_on: date | None


class RunHistory(RunSummary):
    """Rota feita: as entregas que levou (com os comprovantes), o valor e se já foi pago."""

    day_index: int  # Rota 1, 2… do motorista naquele dia
    driver_name: str | None
    plate: str
    stops: list[DeliveryOut]
    payment: RunPayment | None
    expenses: list[ExpenseBrief]  # despesas da rota (pedágio, estacionamento…) e a situação de cada uma
