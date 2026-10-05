"""Preço fixo da rota por região.

Cada rota vale um preço fixo, não importa quantas entregas leve (dentro da capacidade do veículo). A região de uma entrega
é a que lista a cidade dela; se nenhuma lista, a primeira faixa de distância da base (em linha reta) que a cobre. A rota
vale o preço da região mais cara entre as entregas: quem vai até o interior recebe o preço do interior.

A tabela sugerida é para van (tipo Fiat Ducato) e foi montada a partir de uma pesquisa de mercado (2025–2026):
- Shopee, tabela por faixa de km da rota (ida e volta) em Londrina/PR, fev/2025: utilitário de R$ 234 (até 50 km)
  a R$ 437 (até 500 km);
- Mercado Livre: R$ 200 a R$ 400 por rota de van (R$ 300 numa Fiorino no interior de SP);
- Loggi: diária de van ou utilitário de R$ 350 a R$ 700.
Sobre o utilitário somamos cerca de 30% (a van leva mais que o dobro da carga e gasta mais) e a inflação do período.
Para longas distâncias o mercado costuma cotar por viagem; a última faixa é só um ponto de partida para o gestor ajustar.
"""

from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Company, Delivery, RouteRegion
from app.schemas.company import BaseLocation
from app.services import geocoding
from app.services.address import normalize
from app.services.geo import haversine_km
from app.services.trips import company_base

UFS = {
    "ac", "al", "ap", "am", "ba", "ce", "df", "es", "go", "ma", "mt", "ms", "mg", "pa",
    "pb", "pr", "pe", "pi", "rj", "rn", "rs", "ro", "rr", "sc", "sp", "se", "to",
}
GRANDE_BH_CENTER = (-19.9167, -43.9345)
GRANDE_BH_KM = 60  # base a menos disso do centro de BH usa a sugestão com os nomes e cidades da Grande BH


@dataclass(frozen=True)
class Suggested:
    name: str
    max_km: float | None
    price: float
    cities: tuple[str, ...] = ()


GENERIC = (
    Suggested("Até 15 km da base", 15, 320),
    Suggested("Até 40 km da base", 40, 360),
    Suggested("Até 100 km da base", 100, 460),
    Suggested("Até 200 km da base", 200, 600),
    Suggested("Acima de 200 km", None, 950),
)

GRANDE_BH = (
    Suggested("Capital e Contagem", 15, 320, ("Belo Horizonte", "Contagem")),
    Suggested("Região metropolitana", 40, 360, (
        "Betim", "Ibirité", "Sarzedo", "Mário Campos", "São Joaquim de Bicas", "Igarapé", "Juatuba", "Mateus Leme",
        "Esmeraldas", "Ribeirão das Neves", "Vespasiano", "São José da Lapa", "Santa Luzia", "Sabará", "Caeté",
        "Nova Lima", "Raposos", "Rio Acima", "Brumadinho", "Lagoa Santa", "Pedro Leopoldo", "Confins",
    )),
    Suggested("Interior próximo (até 100 km)", 100, 460),
    Suggested("Interior (até 200 km)", 200, 600),
    Suggested("Longa distância (acima de 200 km)", None, 950),
)


def suggested(company: Company) -> tuple[Suggested, ...]:
    base = company_base(company)
    if base and haversine_km(base.latitude, base.longitude, *GRANDE_BH_CENTER) <= GRANDE_BH_KM:
        return GRANDE_BH
    return GENERIC


def city_key(name: str) -> str:
    """"Belo Horizonte - MG", "belo horizonte/mg" e "Belo Horizonte" viram a mesma chave."""
    words = normalize(name).split()
    if len(words) > 1 and words[-1] in UFS:
        words = words[:-1]
    return " ".join(words)


def _ordered(regions: list[RouteRegion]) -> list[RouteRegion]:
    return sorted(regions, key=lambda r: (r.max_km is None, r.max_km or 0, r.id or 0))


def reset(db: Session, company: Company) -> list[RouteRegion]:
    """Volta para a tabela sugerida."""
    db.execute(delete(RouteRegion).where(RouteRegion.company_id == company.id))
    rows = [
        RouteRegion(company_id=company.id, name=s.name, price_cents=round(s.price * 100), max_km=s.max_km, cities=list(s.cities))
        for s in suggested(company)
    ]
    db.add_all(rows)
    db.flush()
    return _ordered(rows)


def table(db: Session, company: Company) -> list[RouteRegion]:
    """Tabela da empresa, da menor faixa para a maior. Na primeira vez, cria a sugerida."""
    rows = list(db.scalars(select(RouteRegion).where(RouteRegion.company_id == company.id)))
    return _ordered(rows) if rows else reset(db, company)


def stop_region(regions: list[RouteRegion], base: BaseLocation | None, city: str,
                latitude: float | None, longitude: float | None) -> RouteRegion | None:
    key = city_key(city)
    for r in regions:
        if key in {city_key(c) for c in r.cities}:
            return r
    if base is None or latitude is None or longitude is None:
        return None
    km = haversine_km(base.latitude, base.longitude, latitude, longitude)
    return next((r for r in _ordered(regions) if r.max_km is None or km <= r.max_km), None)


def route_region(regions: list[RouteRegion], base: BaseLocation | None,
                 stops: list[tuple[str, float | None, float | None]]) -> tuple[RouteRegion | None, int]:
    """Região da rota (a mais cara entre as entregas) e quantas entregas não deu para encaixar em nenhuma."""
    found = [stop_region(regions, base, *s) for s in stops]
    placed = [r for r in found if r]
    best = max(placed, key=lambda r: (r.price_cents, r.max_km is None, r.max_km or 0), default=None)
    return best, len(found) - len(placed)


def apply_to_run(db: Session, run, stops: list[tuple[str, float | None, float | None]]) -> None:
    """Guarda na rota a região e o preço. Ao recalcular só sobe: a rota vale a região mais cara que já atendeu."""
    company = db.get(Company, run.company_id)
    region, _ = route_region(table(db, company), company_base(company), stops)
    if region and (run.region_price_cents is None or region.price_cents > run.region_price_cents):
        run.region_name, run.region_price_cents = region.name, region.price_cents


def estimate(db: Session, company: Company, deliveries: list[Delivery]) -> tuple[RouteRegion | None, int]:
    """Região prevista de um carregamento antes de a rota começar (só com os endereços já localizados, sem internet)."""
    stops = []
    for d in deliveries:
        loc = geocoding.cached(db, d.address, d.city)
        stops.append((d.city, loc.latitude if loc else None, loc.longitude if loc else None))
    return route_region(table(db, company), company_base(company), stops)


def validate(regions: list) -> None:
    """Regras da tabela: nomes e faixas sem repetir, uma faixa sem limite no máximo e cada cidade numa região só."""
    names = [normalize(r.name) for r in regions]
    if len(set(names)) != len(names):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Há duas regiões com o mesmo nome.")
    limits = [r.max_km for r in regions if r.max_km is not None]
    if len(set(limits)) != len(limits):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Duas regiões têm a mesma distância máxima.")
    if sum(1 for r in regions if r.max_km is None) > 1:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Só uma região pode ficar sem limite de distância.")
    seen: dict[str, str] = {}
    for r in regions:
        for city in r.cities:
            key = city_key(city)
            if key in seen and seen[key] != r.name:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{city} está em duas regiões ({seen[key]} e {r.name}).")
            seen[key] = r.name
