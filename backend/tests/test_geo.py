from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.services.geo import count_speeding_events, haversine_km, route_distance_km


@dataclass
class P:
    latitude: float
    longitude: float
    recorded_at: datetime
    speed_kmh: float = 50
    ignition: bool = True
    odometer_km: float | None = None


def test_haversine_bh_to_contagem():
    # Praça Sete (BH) até o centro de Contagem: ~12 km em linha reta
    assert 11.5 < haversine_km(-19.9191, -43.9386, -19.9320, -44.0539) < 12.5


def test_distance_prefers_odometer():
    t = datetime(2026, 10, 1, tzinfo=timezone.utc)
    pts = [P(0, 0, t, odometer_km=1000), P(1, 1, t + timedelta(hours=1), odometer_km=1042.5)]
    assert route_distance_km(pts) == 42.5


def test_distance_ignores_gps_jumps():
    t = datetime(2026, 10, 1, tzinfo=timezone.utc)
    pts = [P(-19.90, -44.0, t), P(-19.91, -44.0, t + timedelta(minutes=1)), P(-10.0, -44.0, t + timedelta(minutes=2))]
    assert route_distance_km(pts) < 2


def test_speeding_counts_episodes():
    t = datetime(2026, 10, 1, tzinfo=timezone.utc)
    speeds = [70, 90, 95, 70, 85, 60]
    pts = [P(0, 0, t + timedelta(minutes=i), speed_kmh=s) for i, s in enumerate(speeds)]
    assert count_speeding_events(pts, 80) == 2
