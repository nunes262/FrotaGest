from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# Posições na ordem em que aparecem: eixo dianteiro, traseiro simples (E2E/E2D), traseiros duplos e estepe
TIRE_POSITIONS = ("E1E", "E1D", "E2E", "E2D", "E2EE", "E2EI", "E2DI", "E2DE", "E3EE", "E3EI", "E3DI", "E3DE", "ESTEPE")
TirePosition = Literal["E1E", "E1D", "E2E", "E2D", "E2EE", "E2EI", "E2DI", "E2DE", "E3EE", "E3EI", "E3DI", "E3DE", "ESTEPE"]
# Posições de cada tipo de rodado traseiro
POSITIONS_BY_LAYOUT = {
    "single": ("E1E", "E1D", "E2E", "E2D", "ESTEPE"),
    "dual": ("E1E", "E1D", "E2EE", "E2EI", "E2DI", "E2DE", "E3EE", "E3EI", "E3DI", "E3DE", "ESTEPE"),
}


class TireCreate(BaseModel):
    position: TirePosition
    brand: str | None = Field(default=None, max_length=120)
    identification: str | None = Field(default=None, max_length=40)
    measured_pct: float | None = Field(default=None, ge=0, le=100, description="Quanto da banda resta, em %")
    # Ou o sulco medido em mm, quando se sabe o sulco do pneu novo
    measured_mm: float | None = Field(default=None, ge=0, le=30)
    tread_new_mm: float | None = Field(default=None, gt=1.6, le=30, description="Sulco do pneu novo, em mm")
    life_km: int = Field(default=80_000, ge=5_000, le=400_000, description="Km de 100% até 0% da banda")
    cost: float | None = Field(default=None, ge=0, description="Preço pago, em R$")


class TireUpdate(BaseModel):
    """Mudar measured_pct registra uma nova medição: a estimativa de desgaste recomeça dali."""

    position: TirePosition | None = None
    brand: str | None = Field(default=None, max_length=120)
    identification: str | None = Field(default=None, max_length=40)
    measured_pct: float | None = Field(default=None, ge=0, le=100)
    measured_mm: float | None = Field(default=None, ge=0, le=30)
    tread_new_mm: float | None = Field(default=None, gt=1.6, le=30)
    life_km: int | None = Field(default=None, ge=5_000, le=400_000)
    cost: float | None = Field(default=None, ge=0)


class TireRotate(BaseModel):
    """Muda o pneu de posição. Se a posição tiver outro pneu, os dois trocam de lugar."""

    position: TirePosition


class TireRetread(BaseModel):
    cost: float | None = Field(default=None, ge=0)
    measured_pct: float = Field(default=100, ge=0, le=100)
    life_km: int | None = Field(default=None, ge=5_000, le=400_000)


class TireEventOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    kind: Literal["mount", "measure", "rotation", "retread"]
    happened_at: datetime
    vehicle_km: float
    measured_pct: float | None
    cost: float | None
    detail: str | None


class TireOut(BaseModel):
    id: int
    vehicle_id: int
    position: TirePosition
    brand: str | None
    identification: str | None
    life_km: int
    measured_pct: float
    measured_at: datetime
    cost: float | None
    retreads: int
    tread_new_mm: float | None
    # Estimativa pelos km rodados em rotas desde a última medição (o estepe não gasta)
    in_use: bool
    km_since_measure: float
    wear_since_measure_pct: float
    estimated_pct: float
    wear_pct: float  # desgaste estimado = 100% − banda restante
    wear_per_1000km_pct: float
    remaining_km: int
    km_on_tire: float  # km rodados em rotas desde que foi montado (ou desde a primeira medição)
    cost_per_km: float | None  # preço ÷ vida útil
    estimated_mm: float | None  # sulco estimado hoje, quando se sabe o sulco novo
    km_to_rotation: int | None  # até o desgaste chegar a 50% (hora do rodízio); 0 se já passou
    km_to_replacement: int  # até o desgaste passar de 75% (trocar)
