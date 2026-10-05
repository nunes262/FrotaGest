"""Worker que consulta os rastreadores e grava as posições no banco.

Rodar:  python -m app.workers.poller          (loop contínuo)
        python -m app.workers.poller --once   (uma rodada só)
"""

import argparse
import logging
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import SessionLocal, init_db
from app.integrations import TrackerPosition, get_adapter
from app.models import Company, Position, TrackerSimulation, Vehicle
from app.services.geo import as_utc

log = logging.getLogger("poller")


def store_positions(db: Session, by_external_id: dict[str, Vehicle], positions: list[TrackerPosition]) -> int:
    """Grava as posições novas (ignora as que já estão no banco). Devolve quantas entraram."""
    positions = [p for p in positions if p.external_vehicle_id in by_external_id]
    if not positions:
        return 0
    ids = [v.id for v in by_external_id.values()]
    oldest = min(as_utc(p.recorded_at) for p in positions)
    existing = {
        (vid, as_utc(t))
        for vid, t in db.execute(
            select(Position.vehicle_id, Position.recorded_at).where(Position.vehicle_id.in_(ids), Position.recorded_at >= oldest)
        ).all()
    }
    inserted = 0
    for p in positions:
        vehicle = by_external_id[p.external_vehicle_id]
        key = (vehicle.id, as_utc(p.recorded_at))
        if key in existing:
            continue
        existing.add(key)
        db.add(
            Position(
                vehicle_id=vehicle.id,
                driver_id=vehicle.current_driver_id,
                recorded_at=p.recorded_at,
                latitude=p.latitude,
                longitude=p.longitude,
                speed_kmh=p.speed_kmh,
                ignition=p.ignition,
                odometer_km=p.odometer_km,
            )
        )
        inserted += 1
    try:
        db.commit()
    except IntegrityError:  # outra coleta gravou a mesma posição ao mesmo tempo
        db.rollback()
        log.warning("Posições repetidas descartadas")
        return 0
    return inserted


def sync_company(db: Session, company: Company) -> int:
    # Veículos com o rastreador simulado ligado recebem as posições dele, não as do provedor
    simulated = select(TrackerSimulation.vehicle_id)
    vehicles = db.scalars(select(Vehicle).where(Vehicle.company_id == company.id, Vehicle.id.not_in(simulated))).all()
    by_provider: dict[str, list[Vehicle]] = defaultdict(list)
    for v in vehicles:
        by_provider[v.tracker_provider.value].append(v)

    inserted = 0
    for provider, group in by_provider.items():
        creds = (company.tracker_credentials or {}).get(provider)
        adapter = get_adapter(provider, creds)
        by_ext = {v.tracker_external_id: v for v in group}

        last = db.scalar(select(func.max(Position.recorded_at)).where(Position.vehicle_id.in_([v.id for v in group])))
        since = as_utc(last) if last else datetime.now(timezone.utc) - timedelta(hours=2)
        try:
            positions = adapter.fetch_positions(list(by_ext), since)
        except Exception as exc:  # um provedor com problema não pode parar os outros
            log.warning("Falha ao consultar %s da empresa %s: %s", provider, company.id, exc)
            continue
        inserted += store_positions(db, by_ext, positions)
    return inserted


def run_once() -> int:
    with SessionLocal() as db:
        total = 0
        for company in db.scalars(select(Company)).all():
            total += sync_company(db, company)
        log.info("Posições novas gravadas: %s", total)
        return total


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    init_db()
    if args.once:
        run_once()
        return
    interval = get_settings().poll_interval_seconds
    while True:
        try:
            run_once()
        except Exception:  # banco ocupado (SQLite) ou falha passageira: tenta de novo na próxima rodada
            log.exception("Falha na coleta; tentando de novo em %s s", interval)
        time.sleep(interval)


if __name__ == "__main__":
    main()
