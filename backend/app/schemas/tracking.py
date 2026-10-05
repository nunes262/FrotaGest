from datetime import date, datetime

from pydantic import BaseModel


class LivePosition(BaseModel):
    vehicle_id: int
    plate: str
    driver_id: int | None
    driver_name: str | None
    latitude: float
    longitude: float
    speed_kmh: float
    ignition: bool
    recorded_at: datetime
    status: str  # "moving" | "stopped" | "offline" | "speeding" | "at_base"


class RouteSummary(BaseModel):
    day: date
    driver_id: int | None
    driver_name: str | None
    vehicle_id: int
    plate: str
    distance_km: float
    driving_minutes: int
    max_speed_kmh: float
    speeding_events: int
    started_at: datetime
    ended_at: datetime


class RoutePoint(BaseModel):
    latitude: float
    longitude: float
    speed_kmh: float
    recorded_at: datetime


class DashboardSummary(BaseModel):
    vehicles_total: int
    vehicles_moving: int
    km_today: float
    deliveries_today: int
    deliveries_pending: int  # ainda aguardando carregamento


class TripOut(BaseModel):
    """Viagem do dia: do momento em que sai da base até voltar. Os índices apontam para RouteDetail.points."""

    start_index: int
    end_index: int
    left_at: datetime
    returned_at: datetime | None
    left_base: bool
    distance_km: float


class RouteDetail(BaseModel):
    points: list[RoutePoint]
    trips: list[TripOut]


class TrailStop(BaseModel):
    order: int
    delivery_id: int
    customer_name: str
    latitude: float
    longitude: float
    status: str  # status da entrega


class TrailRun(BaseModel):
    """Rota de entrega do veículo no dia: o traçado planejado e as paradas."""

    id: int
    status: str
    geometry: list[tuple[float, float]]
    stops: list[TrailStop]


class VehicleTrail(BaseModel):
    """Caminho percorrido pelo veículo no dia (rastreador ou, sem ele, o celular do motorista)."""

    vehicle_id: int
    plate: str
    driver_id: int | None
    driver_name: str | None
    points: list[tuple[float, float]]
    distance_km: float
    run: TrailRun | None
