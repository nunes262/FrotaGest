"""Ordem das paradas e traçado pelas ruas com o OSRM (servidor público de demonstração, sem chave).

O serviço "trip" do OSRM resolve o problema do caixeiro-viajante: visita todas as paradas pelo menor caminho
nas ruas. Se ele não responder, a ordem é aproximada pela parada mais próxima em linha reta.
"""

import logging
import math
from dataclasses import dataclass

import httpx

from app.services.geo import haversine_km

log = logging.getLogger(__name__)

OSRM_TRIP_URL = "https://router.project-osrm.org/trip/v1/driving/"
TIMEOUT_S = 15
MAX_POINTS = 100  # limite do servidor público
ROAD_FACTOR = 1.3  # sem o OSRM: a estrada costuma ser uns 30% mais longa que a linha reta
# O traçado vem completo (segue as ruas) e é enxugado: pontos a menos de 3 m da linha entre os vizinhos saem
SIMPLIFY_M = 3.0

LatLon = tuple[float, float]


class RoutingError(Exception):
    """O OSRM não conseguiu montar a rota."""


@dataclass(frozen=True)
class RoutePlan:
    order: list[int]  # índices das paradas na ordem de visita
    legs_km: list[float]  # km do ponto anterior até cada parada, na ordem de visita
    return_km: float | None  # da última parada de volta ao fim (a base)
    distance_km: float
    duration_min: int | None
    geometry: list[list[float]]  # [[lat, lon], ...]
    optimized: bool  # False quando a ordem foi aproximada sem o OSRM


def plan_route(origin: LatLon | None, stops: list[LatLon], end: LatLon | None = None) -> RoutePlan:
    """Melhor ordem para visitar as paradas saindo da origem e terminando no fim (normalmente a base).
    O fim só é usado junto com a origem."""
    if not stops:
        return RoutePlan([], [], None, 0.0, 0, [], True)
    end = end if origin else None
    try:
        return _osrm_trip(origin, stops, end)
    except RoutingError as e:
        log.warning("OSRM indisponível, ordem aproximada: %s", e)
        return _nearest_neighbor(origin, stops, end)


def _osrm_request(path: str, params: dict) -> dict:
    try:
        r = httpx.get(OSRM_TRIP_URL + path, params=params, timeout=TIMEOUT_S)
        data = r.json()
    except (httpx.HTTPError, ValueError) as e:
        raise RoutingError(str(e)) from e
    if data.get("code") != "Ok":
        raise RoutingError(data.get("message") or data.get("code"))
    return data


def _osrm_trip(origin: LatLon | None, stops: list[LatLon], end: LatLon | None) -> RoutePlan:
    coords = ([origin] if origin else []) + stops + ([end] if end else [])
    if len(coords) > MAX_POINTS:
        raise RoutingError(f"{len(coords)} pontos passam do limite de {MAX_POINTS}")
    if len(coords) < 2:
        raise RoutingError("pontos insuficientes")
    # Combinações aceitas pelo OSRM: ida com início e fim fixos, ou volta ao ponto de partida
    if origin and end:
        params = {"roundtrip": "false", "source": "first", "destination": "last"}
    elif origin:
        params = {"roundtrip": "true", "source": "first"}
    else:
        params = {"roundtrip": "true", "source": "any"}
    params |= {"overview": "full", "geometries": "geojson"}

    data = _osrm_request(";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in coords), params)
    trip = data["trips"][0]
    offset = 1 if origin else 0
    visit = [w["waypoint_index"] for w in data["waypoints"]]
    order = sorted(range(len(stops)), key=lambda i: visit[i + offset])
    legs = trip["legs"]
    if origin:
        used, back = legs[: len(stops)], legs[len(stops) :]
    else:
        # Sem origem a primeira parada é o começo; o último trecho voltaria a ela e não conta
        used, back = legs[: len(stops) - 1], []
    legs_km = ([] if origin else [0.0]) + [round(leg["distance"] / 1000, 1) for leg in used]
    return_km = round(sum(leg["distance"] for leg in back) / 1000, 1) if back else None
    return RoutePlan(
        order=order,
        legs_km=legs_km,
        return_km=return_km,
        distance_km=round(sum(legs_km) + (return_km or 0), 1),
        duration_min=round(sum(leg["duration"] for leg in used + back) / 60),
        geometry=simplify([[lat, lon] for lon, lat in trip["geometry"]["coordinates"]], SIMPLIFY_M),
        optimized=True,
    )


def simplify(points: list[list[float]], tolerance_m: float) -> list[list[float]]:
    """Douglas-Peucker: tira os pontos que quase não mudam o desenho (retas com muitos pontos), mantendo as curvas."""
    if len(points) < 3:
        return points
    lat0 = math.radians(points[0][0])
    xy = [(lon * 111_320 * math.cos(lat0), lat * 110_540) for lat, lon in points]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        (ax, ay), (bx, by) = xy[first], xy[last]
        dx, dy = bx - ax, by - ay
        seg = math.hypot(dx, dy)
        far, far_d = None, tolerance_m
        for i in range(first + 1, last):
            px, py = xy[i]
            d = abs(dy * (px - ax) - dx * (py - ay)) / seg if seg else math.hypot(px - ax, py - ay)
            if d > far_d:
                far, far_d = i, d
        if far is not None:
            keep[far] = True
            stack += [(first, far), (far, last)]
    return [p for p, k in zip(points, keep) if k]


def _nearest_neighbor(origin: LatLon | None, stops: list[LatLon], end: LatLon | None) -> RoutePlan:
    road_km = lambda a, b: round(haversine_km(*a, *b) * ROAD_FACTOR, 1)  # noqa: E731
    remaining = list(range(len(stops)))
    order: list[int] = []
    legs_km: list[float] = []
    current = origin
    if current is None:
        order.append(remaining.pop(0))
        legs_km.append(0.0)
        current = stops[order[0]]
    while remaining:
        nearest = min(remaining, key=lambda i: haversine_km(*current, *stops[i]))
        remaining.remove(nearest)
        order.append(nearest)
        legs_km.append(road_km(current, stops[nearest]))
        current = stops[nearest]
    return_km = road_km(current, end) if end else None
    path = ([origin] if origin else []) + [stops[i] for i in order] + ([end] if end else [])
    return RoutePlan(
        order=order,
        legs_km=legs_km,
        return_km=return_km,
        distance_km=round(sum(legs_km) + (return_km or 0), 1),
        duration_min=None,
        geometry=[list(p) for p in path],
        optimized=False,
    )
