from typing import Literal

from pydantic import BaseModel, Field

SimPhase = Literal["idle", "driving", "at_stop", "returning", "at_base"]


class SimulationIn(BaseModel):
    """Ajustes do rastreador simulado. Campos omitidos ficam como estão."""

    speed_factor: float | None = Field(default=None, ge=1, le=120)
    cruise_kmh: float | None = Field(default=None, ge=5, le=110)
    dwell_min: float | None = Field(default=None, ge=0, le=60)
    auto_driver: bool | None = None
    paused: bool | None = None


class SimulationStop(BaseModel):
    delivery_id: int
    customer_name: str
    order: int | None
    resolved: bool


class SimulationOut(BaseModel):
    vehicle_id: int
    plate: str
    driver_name: str | None
    speed_factor: float
    cruise_kmh: float
    dwell_min: float
    auto_driver: bool
    paused: bool
    phase: SimPhase
    phase_text: str
    run_id: int | None  # rota em andamento do veículo
    following: bool  # já está andando por essa rota
    progress_km: float
    route_km: float | None
    stops_total: int
    stops_done: int
    # Entrega onde está parado ou a próxima do caminho
    stop: SimulationStop | None
    latitude: float | None
    longitude: float | None


class SimulationReset(BaseModel):
    runs: int
    deliveries: int
    positions: int
