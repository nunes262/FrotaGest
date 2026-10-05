"""Endereço → coordenadas pelo Nominatim (OpenStreetMap), com cache no banco.

A política de uso do Nominatim pede no máximo 1 requisição por segundo, um User-Agent próprio e cache dos resultados.
"""

import threading
import time
from dataclasses import dataclass

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import GeocodedAddress
from app.services.address import normalize

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
MIN_INTERVAL_S = 1.0
TIMEOUT_S = 8
# Prefere resultados até uns 300 km da base (há cidades com o mesmo nome em outros estados)
NEAR_DEGREES = 3

_lock = threading.Lock()
_last_call = 0.0


class GeocodingError(Exception):
    """O Nominatim não respondeu."""


@dataclass(frozen=True)
class Location:
    latitude: float
    longitude: float
    precision: str  # "address" (com o número), "street" (só a rua) ou "city" (centro da cidade)


def search(q: str, limit: int = 5, near: tuple[float, float] | None = None) -> list[dict]:
    """Busca no Nominatim, uma chamada por vez e com o intervalo mínimo entre elas."""
    params = {"q": q, "format": "jsonv2", "limit": limit, "countrycodes": "br", "accept-language": "pt-BR"}
    if near:
        lat, lon = near
        params["viewbox"] = f"{lon - NEAR_DEGREES},{lat + NEAR_DEGREES},{lon + NEAR_DEGREES},{lat - NEAR_DEGREES}"
    return _request(NOMINATIM_URL, params)


def reverse_place(latitude: float, longitude: float) -> tuple[str | None, str | None]:
    """(cidade, UF) de um ponto do mapa, ou (None, None) se o Nominatim não souber."""
    data = _request(NOMINATIM_REVERSE_URL, {"lat": latitude, "lon": longitude, "format": "jsonv2", "zoom": 10, "accept-language": "pt-BR"})
    address = data.get("address", {}) if isinstance(data, dict) else {}
    city = next((address[k] for k in ("city", "town", "municipality", "village") if address.get(k)), None)
    code = address.get("ISO3166-2-lvl4", "")  # "BR-MG"
    return city, code[3:] if code.startswith("BR-") else None


def _request(url: str, params: dict):
    global _last_call
    with _lock:
        wait = MIN_INTERVAL_S - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        try:
            r = httpx.get(url, params=params, headers={"User-Agent": f"{get_settings().app_name}/0.1"}, timeout=TIMEOUT_S)
            r.raise_for_status()
            return r.json()
        except (httpx.HTTPError, ValueError) as e:
            raise GeocodingError(str(e)) from e
        finally:
            _last_call = time.monotonic()


def cached(db: Session, address: str, city: str) -> Location | None:
    """Coordenadas já guardadas (sem chamar o Nominatim), ou nulo."""
    row = db.scalar(select(GeocodedAddress).where(GeocodedAddress.query == normalize(f"{address} | {city}")[:400]))
    return Location(row.latitude, row.longitude, row.precision) if row and row.latitude is not None else None


def locate(db: Session, address: str, city: str, near: tuple[float, float] | None = None) -> Location | None:
    """Coordenadas da entrega. Sem resultado com o número, tenta só a rua e depois o centro da cidade.
    Levanta GeocodingError se o Nominatim falhar (aí nada vai para o cache e a próxima vez tenta de novo)."""
    key = normalize(f"{address} | {city}")[:400]
    cached = db.scalar(select(GeocodedAddress).where(GeocodedAddress.query == key))
    if cached:
        return Location(cached.latitude, cached.longitude, cached.precision) if cached.latitude is not None else None

    street = address.split(",")[0].strip()
    attempts = [("address", f"{address}, {city}"), ("street", f"{street}, {city}"), ("city", city)]
    found = None
    for precision, q in attempts:
        if precision == "street" and street == address.strip():
            continue  # sem número, a primeira busca já foi só pela rua
        rows = search(f"{q}, Brasil", limit=1, near=near)
        if rows:
            found = Location(float(rows[0]["lat"]), float(rows[0]["lon"]), precision)
            break

    db.add(GeocodedAddress(
        query=key,
        latitude=found.latitude if found else None,
        longitude=found.longitude if found else None,
        precision=found.precision if found else None,
    ))
    try:
        db.commit()
    except IntegrityError:  # outra requisição gravou o mesmo endereço ao mesmo tempo
        db.rollback()
    return found
