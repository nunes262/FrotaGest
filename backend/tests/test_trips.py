from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.schemas.company import BaseLocation
from app.services.trips import split_trips

BASE = BaseLocation(name="CD", latitude=0, longitude=0, radius_m=300)
T0 = datetime(2026, 10, 4, 8, 0, tzinfo=timezone.utc)


@dataclass
class P:
    latitude: float
    longitude: float
    recorded_at: datetime
    odometer_km: float | None = None


def track(*lats: float) -> list[P]:
    return [P(lat, 0, T0 + timedelta(minutes=i)) for i, lat in enumerate(lats)]


def test_split_trips_from_base():
    points = track(
        0.02,                    # o dia começa com o caminhão fora da base
        0,                       # chega na base
        0.01, 0.02,              # sai, faz a entrega
        0,                       # volta
        0.0026, 0.0028, 0.0026,  # parado na borda do raio: ruído do GPS, não é viagem
        0.01, 0.02,              # sai de novo e ainda não voltou
    )
    trips = split_trips(points, BASE)
    assert [(t.start, t.end, t.left_base, t.returned) for t in trips] == [
        (0, 1, False, True),
        (1, 4, True, True),
        (7, 9, True, False),
    ]
    assert trips[1].distance_km > 4


def test_split_trips_all_day_at_base():
    assert split_trips(track(0, 0, 0.001, 0), BASE) == []
