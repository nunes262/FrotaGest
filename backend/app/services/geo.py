import math
from collections.abc import Sequence
from datetime import datetime, timezone

EARTH_RADIUS_KM = 6371.0088
# Saltos maiores que isso entre dois pontos seguidos são tratados como ruído de GPS
MAX_PLAUSIBLE_SPEED_KMH = 160


def as_utc(dt: datetime) -> datetime:
    """SQLite devolve datas sem fuso; tratamos tudo como UTC."""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def route_distance_km(points: Sequence) -> float:
    """Distância percorrida. Usa o hodômetro do rastreador quando disponível,
    senão soma os trechos entre pontos descartando saltos impossíveis."""
    if len(points) < 2:
        return 0.0
    first, last = points[0], points[-1]
    if first.odometer_km is not None and last.odometer_km is not None and last.odometer_km >= first.odometer_km:
        return round(last.odometer_km - first.odometer_km, 2)

    total = 0.0
    for a, b in zip(points, points[1:]):
        d = haversine_km(a.latitude, a.longitude, b.latitude, b.longitude)
        hours = (as_utc(b.recorded_at) - as_utc(a.recorded_at)).total_seconds() / 3600
        if hours > 0 and d / hours > MAX_PLAUSIBLE_SPEED_KMH:
            continue
        total += d
    return round(total, 2)


def driving_minutes(points: Sequence, moving_threshold_kmh: float = 5) -> int:
    seconds = 0.0
    for a, b in zip(points, points[1:]):
        if a.ignition and a.speed_kmh >= moving_threshold_kmh:
            seconds += (as_utc(b.recorded_at) - as_utc(a.recorded_at)).total_seconds()
    return int(seconds // 60)


def count_speeding_events(points: Sequence, limit_kmh: float) -> int:
    """Conta episódios (não pontos): vários pontos seguidos acima do limite valem um evento."""
    events, above = 0, False
    for p in points:
        if p.speed_kmh > limit_kmh and not above:
            events += 1
        above = p.speed_kmh > limit_kmh
    return events
