"""Divide o trajeto do dia em viagens a partir da base (CD) da empresa."""

from collections.abc import Sequence
from dataclasses import dataclass

from app.models import Company
from app.schemas.company import BaseLocation
from app.services.geo import haversine_km, route_distance_km

# Saídas que mal se afastam da base (ruído do GPS na borda do raio) não contam como viagem
MIN_TRIP_KM = 0.5


@dataclass(frozen=True)
class Trip:
    start: int  # índice do último ponto na base antes de sair (ou do primeiro ponto do dia)
    end: int  # índice do primeiro ponto de volta à base (ou do último ponto, se ainda está fora)
    left_base: bool  # False quando o dia já começou com o caminhão fora da base
    returned: bool
    distance_km: float


def company_base(company: Company) -> BaseLocation | None:
    if company.base_latitude is None or company.base_longitude is None:
        return None
    return BaseLocation(
        name=company.base_name or "Base",
        address=company.base_address,
        latitude=company.base_latitude,
        longitude=company.base_longitude,
        radius_m=company.base_radius_m or 300,
    )


def is_at_base(latitude: float, longitude: float, base: BaseLocation) -> bool:
    return haversine_km(latitude, longitude, base.latitude, base.longitude) * 1000 <= base.radius_m


def split_trips(points: Sequence, base: BaseLocation) -> list[Trip]:
    """Cada trecho fora do raio vira uma viagem. Ela começa no último ponto dentro da base,
    para o trajeto sair do CD, e termina no primeiro ponto de volta."""
    inside = [is_at_base(p.latitude, p.longitude, base) for p in points]
    trips: list[Trip] = []
    i, n = 0, len(points)
    while i < n:
        if inside[i]:
            i += 1
            continue
        j = i
        while j < n and not inside[j]:
            j += 1
        start, end = (i - 1 if i > 0 else i), (j if j < n else n - 1)
        distance = route_distance_km(points[start : end + 1])
        if distance >= MIN_TRIP_KM:
            trips.append(Trip(start=start, end=end, left_base=i > 0, returned=j < n, distance_km=distance))
        i = j
    return trips
