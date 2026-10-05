from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.fleet import FuelType


class FuelPriceOut(BaseModel):
    fuel_type: FuelType
    price_per_liter: float | None
    source: Literal["anp", "manual"] | None
    reference: str | None
    updated_at: datetime | None


class FuelPriceIn(BaseModel):
    price_per_liter: float = Field(gt=0, le=50)


class VehicleCost(BaseModel):
    vehicle_id: int
    plate: str
    model: str | None
    drivers: list[str]  # quem rodou com o veículo no período
    fuel_type: FuelType | None
    km_per_liter: float | None
    distance_km: float
    liters: float | None
    fuel_cost: float | None
    tire_cost: float
    total_cost: float | None
    cost_per_km: float | None
    # O que falta para o custo ficar completo: "fuel_type", "km_per_liter", "price"
    missing: list[str]
    # Abastecimentos registrados pelos motoristas no período: gasto real e o consumo que ele indica
    refuel_liters: float = 0
    refuel_spent: float = 0
    refuel_count: int = 0
    real_km_per_liter: float | None = None  # km das rotas ÷ litros abastecidos
    consumption_alert: bool = False  # consumo real mais de 20% pior que o informado


class CostSummary(BaseModel):
    date_from: date
    date_to: date
    fuel_type: FuelType | None
    prices: list[FuelPriceOut]
    vehicles: list[VehicleCost]
    distance_km: float
    fuel_cost: float
    tire_cost: float
    total_cost: float
    cost_per_km: float | None
    refuel_spent: float = 0  # gasto real com combustível (abastecimentos do período)
    refuel_liters: float = 0
