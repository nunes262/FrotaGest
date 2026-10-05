from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


@dataclass(frozen=True)
class TrackerPosition:
    """Formato único usado pelo FrotaGest, independente do rastreador de origem."""

    external_vehicle_id: str
    recorded_at: datetime
    latitude: float
    longitude: float
    speed_kmh: float
    ignition: bool
    odometer_km: float | None = None
    external_driver_id: str | None = None
    # Endereço já resolvido pelo rastreador, quando ele manda (só para mostrar; não vai para o banco)
    address: str | None = None


@dataclass(frozen=True)
class TrackerVehicle:
    """Veículo como aparece no sistema do rastreador."""

    external_id: str
    plate: str | None
    description: str | None


class TrackerError(Exception):
    """O rastreador recusou ou não respondeu (credencial errada, fora do ar, limite de consultas)."""


class TrackerAdapter(ABC):
    """Cada provedor (Sascar, Onixsat...) implementa esta interface."""

    provider: str

    def __init__(self, credentials: dict | None = None):
        self.credentials = credentials or {}

    @abstractmethod
    def fetch_positions(self, external_vehicle_ids: list[str], since: datetime) -> list[TrackerPosition]:
        """Devolve as posições registradas depois de `since` para os veículos informados."""

    def list_vehicles(self) -> list[TrackerVehicle]:
        """Veículos liberados para esta integração (usado para testar a conexão)."""
        raise NotImplementedError

    def is_vehicle_integrated(self, external_vehicle_id: str) -> bool | None:
        """Se o veículo está liberado para a integração; None quando o provedor não informa."""
        return None

    def recent_positions(self, external_vehicle_id: str, hours: int = 24) -> list[TrackerPosition]:
        """Posições recentes de um veículo, para conferir se ele está transmitindo."""
        since = datetime.now(timezone.utc) - timedelta(hours=hours)
        return self.fetch_positions([external_vehicle_id], since)
