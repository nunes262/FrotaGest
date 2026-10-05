from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class TrackerConnectionIn(BaseModel):
    """Usuário e senha de integração liberados pelo rastreador (na Sascar: integrador do SasIntegra)."""

    user: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=200)


class TrackerVehicleOut(BaseModel):
    external_id: str
    plate: str | None
    description: str | None
    # Veículo do FrotaGest com esse código no rastreador, se houver
    vehicle_id: int | None
    vehicle_plate: str | None


class TrackerConnectionOut(BaseModel):
    provider: Literal["sascar"]
    configured: bool
    user: str | None  # a senha nunca sai do servidor
    vehicles: list[TrackerVehicleOut] = []


class LastPosition(BaseModel):
    recorded_at: datetime
    latitude: float
    longitude: float
    speed_kmh: float
    ignition: bool
    address: str | None


class TrackerCheckOut(BaseModel):
    vehicle_id: int
    plate: str
    external_id: str
    # transmitting: mandou posição nas últimas 24 h; silent: nenhuma; not_integrated: não liberado para a integração
    status: Literal["transmitting", "silent", "not_integrated"]
    positions_found: int
    stored: int  # quantas eram novas e foram gravadas (já aparecem no mapa)
    last: LastPosition | None
