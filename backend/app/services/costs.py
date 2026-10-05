"""Custo por km da frota sobre os km rodados nas rotas: combustível (preço do litro ÷ consumo) e pneus (preço ÷ vida útil)."""

import logging
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import SPARE_POSITION, Company, DeliveryRun, FuelEntry, FuelPrice, Tire, User, Vehicle
from app.schemas.costs import CostSummary, FuelPriceOut, VehicleCost
from app.services import fuel, geocoding
from app.services.geo import as_utc
from app.services.runs import run_km

log = logging.getLogger(__name__)

FUEL_TYPES = ("diesel", "gasolina")
# O preço da ANP é semanal: depois disso, busca de novo sozinho (o informado à mão nunca é trocado sozinho)
ANP_MAX_AGE = timedelta(days=7)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stored(db: Session, company_id: int) -> dict[str, FuelPrice]:
    return {p.fuel_type: p for p in db.scalars(select(FuelPrice).where(FuelPrice.company_id == company_id))}


def _save(db: Session, company_id: int, fuel_type: str, price: float, source: str, reference: str | None) -> None:
    row = _stored(db, company_id).get(fuel_type) or FuelPrice(company_id=company_id, fuel_type=fuel_type)
    row.price_per_liter, row.source, row.reference, row.updated_at = round(price, 3), source, reference, _now()
    db.add(row)


def refresh_from_anp(db: Session, company: Company, only: set[str] | None = None) -> None:
    """Busca o preço da semana na ANP para a cidade da base (ou a média do estado)."""
    city, uf = fuel.place_from_address(company.base_address)
    if not uf and company.base_latitude is not None:
        # Endereço sem "Cidade/UF": descobre pelo ponto da base no mapa
        try:
            city, uf = geocoding.reverse_place(company.base_latitude, company.base_longitude)
        except geocoding.GeocodingError as e:
            log.warning("Não consegui descobrir a cidade da base: %s", e)
    if not uf:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Informe a cidade e o estado da base em Configurações para buscar o preço da ANP.",
        )
    try:
        found = fuel.anp_prices(city, uf)
    except fuel.FuelPriceError as e:
        log.warning("Preço da ANP indisponível: %s", e)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Não consegui buscar o preço na ANP agora. Informe o preço do litro à mão.")
    for fuel_type, p in found.items():
        if only is None or fuel_type in only:
            _save(db, company.id, fuel_type, p.price, "anp", p.reference)
    db.commit()


def ensure_prices(db: Session, company: Company) -> dict[str, FuelPrice]:
    """Preenche sozinho, pela ANP, o que falta ou está velho. Se a ANP falhar, segue com o que tem."""
    stored = _stored(db, company.id)
    stale = {
        f for f in FUEL_TYPES
        if f not in stored or (stored[f].source == "anp" and _now() - as_utc(stored[f].updated_at) > ANP_MAX_AGE)
    }
    if stale:
        try:
            refresh_from_anp(db, company, only=stale)
        except HTTPException as e:
            log.info("Preço automático não atualizado: %s", e.detail)
        stored = _stored(db, company.id)
    return stored


def set_manual(db: Session, company_id: int, fuel_type: str, price: float) -> None:
    _save(db, company_id, fuel_type, price, "manual", "Informado pela empresa")
    db.commit()


def price_list(stored: dict[str, FuelPrice]) -> list[FuelPriceOut]:
    return [
        FuelPriceOut(
            fuel_type=f,
            price_per_liter=stored[f].price_per_liter if f in stored else None,
            source=stored[f].source if f in stored else None,
            reference=stored[f].reference if f in stored else None,
            updated_at=as_utc(stored[f].updated_at) if f in stored else None,
        )
        for f in FUEL_TYPES
    ]


def cost_summary(db: Session, company: Company, date_from: date, date_to: date, fuel_type: str | None) -> CostSummary:
    stored = ensure_prices(db, company)
    vehicles = db.scalars(select(Vehicle).where(Vehicle.company_id == company.id).order_by(Vehicle.plate)).all()
    if fuel_type:
        vehicles = [v for v in vehicles if v.fuel_type == fuel_type]

    runs = db.scalars(
        select(DeliveryRun).where(DeliveryRun.company_id == company.id, DeliveryRun.day.between(date_from, date_to))
    ).all()
    km: dict[int, float] = defaultdict(float)
    drivers: dict[int, set[int]] = defaultdict(set)
    for run in runs:
        km[run.vehicle_id] += run_km(db, run)
        drivers[run.vehicle_id].add(run.driver_id)
    names = dict(db.execute(select(User.id, User.name).where(User.company_id == company.id)).all())

    # Custo do pneu por km: soma de preço ÷ vida útil dos pneus que estão rodando
    tire_cpk: dict[int, float] = defaultdict(float)
    for t in db.scalars(select(Tire).where(Tire.company_id == company.id, Tire.position != SPARE_POSITION)):
        if t.cost:
            tire_cpk[t.vehicle_id] += t.cost / t.life_km

    # Abastecimentos do período (dias no fuso da empresa)
    tz = ZoneInfo(get_settings().timezone)
    refuels: dict[int, list[FuelEntry]] = defaultdict(list)
    for f in db.scalars(select(FuelEntry).where(
        FuelEntry.company_id == company.id,
        FuelEntry.filled_at.between(datetime.combine(date_from, time.min, tzinfo=tz), datetime.combine(date_to, time.max, tzinfo=tz)),
    )):
        refuels[f.vehicle_id].append(f)

    rows: list[VehicleCost] = []
    for v in vehicles:
        distance = round(km[v.id], 1)
        price = stored[v.fuel_type].price_per_liter if v.fuel_type in stored else None
        missing = [f for f, ok in (("fuel_type", v.fuel_type), ("km_per_liter", v.km_per_liter), ("price", price)) if not ok]
        liters = round(distance / v.km_per_liter, 1) if v.km_per_liter else None
        fuel_cost = round(liters * price, 2) if liters is not None and price else None
        tire_cost = round(distance * tire_cpk[v.id], 2)
        total = round((fuel_cost or 0) + tire_cost, 2)
        ran = drivers[v.id] or ({v.current_driver_id} if v.current_driver_id else set())
        filled = refuels[v.id]
        refuel_liters = round(sum(f.liters for f in filled), 1)
        real_kml = round(distance / refuel_liters, 1) if refuel_liters and distance else None
        rows.append(VehicleCost(
            vehicle_id=v.id, plate=v.plate, model=v.model, drivers=sorted(names.get(d, "?") for d in ran),
            fuel_type=v.fuel_type, km_per_liter=v.km_per_liter, distance_km=distance, liters=liters,
            fuel_cost=fuel_cost, tire_cost=tire_cost, total_cost=total if distance else 0.0,
            cost_per_km=round(total / distance, 2) if distance else None, missing=missing,
            refuel_liters=refuel_liters, refuel_spent=round(sum(f.total_cents for f in filled) / 100, 2), refuel_count=len(filled),
            real_km_per_liter=real_kml,
            consumption_alert=bool(real_kml and v.km_per_liter and real_kml < v.km_per_liter * 0.8),
        ))

    total_km = round(sum(r.distance_km for r in rows), 1)
    fuel_total = round(sum(r.fuel_cost or 0 for r in rows), 2)
    tire_total = round(sum(r.tire_cost for r in rows), 2)
    return CostSummary(
        date_from=date_from, date_to=date_to, fuel_type=fuel_type, prices=price_list(stored), vehicles=rows,
        distance_km=total_km, fuel_cost=fuel_total, tire_cost=tire_total, total_cost=round(fuel_total + tire_total, 2),
        cost_per_km=round((fuel_total + tire_total) / total_km, 2) if total_km else None,
        refuel_spent=round(sum(r.refuel_spent for r in rows), 2), refuel_liters=round(sum(r.refuel_liters for r in rows), 1),
    )
