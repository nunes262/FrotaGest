from pydantic import BaseModel, Field


class RegionIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    price: float = Field(gt=0, le=1_000_000, description="Preço fixo da rota (R$)")
    max_km: float | None = Field(default=None, gt=0, le=5000, description="Distância em linha reta da base; nulo = sem limite")
    cities: list[str] = Field(default_factory=list, max_length=300)


class RegionOut(RegionIn):
    id: int


class RegionTable(BaseModel):
    regions: list[RegionOut]
    has_base: bool  # sem a base, só valem as cidades listadas


class RegionTableIn(BaseModel):
    regions: list[RegionIn] = Field(min_length=1, max_length=20)


class RegionEstimate(BaseModel):
    """Região e preço previstos do carregamento de um motorista num dia (antes de a rota começar)."""

    driver_id: int
    region_name: str | None
    price: float | None
    unplaced: int  # entregas que não deu para encaixar (endereço ainda não localizado e cidade fora das listas)
