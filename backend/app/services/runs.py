"""Rotas de entrega: ordem otimizada das paradas, km rodados e desgaste estimado dos pneus.

Os km vêm do rastreador do veículo quando ele manda posições durante a rota; senão, do GPS do celular do motorista.
O desgaste dos pneus é linear: cada pneu perde 100% da banda em `life_km` quilômetros rodados em rotas.
"""

import logging
from collections.abc import Sequence
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models import (
    LEGAL_MIN_TREAD_MM,
    SPARE_POSITION,
    Company,
    Delivery,
    DeliveryRun,
    DeliveryProof,
    DeliveryStatus,
    DriverPayment,
    Position,
    RouteExpense,
    RunPause,
    RunPoint,
    RunStatus,
    Tire,
    TrackerSimulation,
    User,
    UserRole,
    Vehicle,
)
from app.schemas.deliveries import DeliveryOut, ProofOut
from app.schemas.runs import PauseOut, RunHistory, RunOut, RunPayment, RunPointIn, RunStop, RunSummary
from app.schemas.tires import TIRE_POSITIONS, TireOut
from app.services import checklists, geocoding, regions, routing
from app.services.geo import MAX_PLAUSIBLE_SPEED_KMH, as_utc, haversine_km, route_distance_km
from app.services.expenses import brief as expense_brief
from app.services.trips import company_base

log = logging.getLogger(__name__)

# Pontos do celular com precisão pior que isso são descartados
MAX_ACCURACY_M = 100
# Parado, o GPS do celular "anda" alguns metros: só conta deslocamento a partir disso
MIN_STEP_M = 25
# Posição mais antiga que isso não serve de ponto de partida para recalcular
FRESH_POSITION = timedelta(minutes=10)
# O celular pode mandar a posição obtida pouco antes de tocar em "Iniciar rota": ela vale como ponto de partida
EARLY_POINT = timedelta(minutes=5)
MAX_TRAIL_POINTS = 600
# Paradas já resolvidas: entregue ou o cliente não recebeu
DONE = (DeliveryStatus.delivered, DeliveryStatus.failed)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------- km rodados ----------

def phone_distance_km(points: Sequence[RunPoint]) -> float:
    """Soma os deslocamentos do celular ignorando o tremor do GPS parado e saltos impossíveis."""
    if len(points) < 2:
        return 0.0
    total, anchor = 0.0, points[0]
    for p in points[1:]:
        d = haversine_km(anchor.latitude, anchor.longitude, p.latitude, p.longitude)
        if d * 1000 < MIN_STEP_M:
            continue
        hours = (as_utc(p.recorded_at) - as_utc(anchor.recorded_at)).total_seconds() / 3600
        if hours <= 0 or d / hours <= MAX_PLAUSIBLE_SPEED_KMH:
            total += d
        anchor = p
    return round(total, 2)


def _tracker_points(db: Session, run: DeliveryRun) -> list[Position]:
    end = run.finished_at or _now()
    q = select(Position).where(Position.vehicle_id == run.vehicle_id, Position.recorded_at.between(run.started_at, end))
    return list(db.scalars(q.order_by(Position.recorded_at)))


def _phone_points(db: Session, run: DeliveryRun) -> list[RunPoint]:
    return list(db.scalars(select(RunPoint).where(RunPoint.run_id == run.id).order_by(RunPoint.recorded_at)))


def is_simulated(db: Session, vehicle_id: int) -> bool:
    """O veículo está com o rastreador simulado ligado (opções de desenvolvedor)."""
    return db.get(TrackerSimulation, vehicle_id) is not None


def run_distance(db: Session, run: DeliveryRun) -> tuple[float, str | None, Sequence]:
    """(km, fonte, pontos do trajeto). O rastreador tem preferência; sem ele, vale o celular.
    Com o rastreador simulado, o celular (que está em outro lugar) não entra na conta."""
    tracker = _tracker_points(db, run)
    if len(tracker) >= 2 or (tracker and is_simulated(db, run.vehicle_id)):
        return route_distance_km(tracker), "tracker", tracker
    phone = [] if is_simulated(db, run.vehicle_id) else _phone_points(db, run)
    if phone:
        return phone_distance_km(phone), "phone", phone
    return 0.0, ("tracker" if tracker else None), tracker


def run_km(db: Session, run: DeliveryRun) -> float:
    if run.status == RunStatus.finished and run.distance_km is not None:
        return run.distance_km
    return run_distance(db, run)[0]


def vehicle_route_km(db: Session, vehicle_id: int) -> float:
    """Km que o veículo já rodou em rotas (as encerradas e a que está em andamento)."""
    finished = db.scalar(
        select(func.coalesce(func.sum(DeliveryRun.distance_km), 0.0)).where(
            DeliveryRun.vehicle_id == vehicle_id, DeliveryRun.status == RunStatus.finished
        )
    )
    active = db.scalar(select(DeliveryRun).where(DeliveryRun.vehicle_id == vehicle_id, DeliveryRun.status == RunStatus.active))
    archived = db.scalar(select(Vehicle.archived_route_km).where(Vehicle.id == vehicle_id)) or 0.0
    return float(finished or 0) + archived + (run_km(db, active) if active else 0.0)


# ---------- pneus ----------

def tire_out(tire: Tire, vehicle_km: float) -> TireOut:
    in_use = tire.position != SPARE_POSITION
    km_since = max(0.0, vehicle_km - tire.km_at_measure) if in_use else 0.0
    wear = km_since / tire.life_km * 100
    estimated = max(0.0, tire.measured_pct - wear)
    mounted_km = tire.km_at_mount if tire.km_at_mount is not None else tire.km_at_measure
    return TireOut(
        id=tire.id,
        vehicle_id=tire.vehicle_id,
        position=tire.position,
        brand=tire.brand,
        identification=tire.identification,
        life_km=tire.life_km,
        measured_pct=tire.measured_pct,
        measured_at=as_utc(tire.measured_at),
        cost=tire.cost,
        retreads=tire.retreads or 0,
        in_use=in_use,
        km_since_measure=round(km_since, 1),
        wear_since_measure_pct=round(wear, 4),
        estimated_pct=round(estimated, 2),
        wear_pct=round(100 - estimated, 2),
        wear_per_1000km_pct=round(100_000 / tire.life_km, 3) if in_use else 0.0,
        remaining_km=round(estimated / 100 * tire.life_km),
        km_on_tire=round(max(0.0, vehicle_km - mounted_km), 1),
        cost_per_km=round(tire.cost / tire.life_km, 4) if tire.cost else None,
        tread_new_mm=tire.tread_new_mm,
        estimated_mm=round(pct_to_mm(estimated, tire.tread_new_mm), 1) if tire.tread_new_mm else None,
        # Faixas da tela: desgaste até 50% bom, de 50% a 75% rodízio, acima de 75% trocar
        km_to_rotation=round(max(0.0, estimated - 50) / 100 * tire.life_km) if in_use else None,
        km_to_replacement=round(max(0.0, estimated - 25) / 100 * tire.life_km),
    )


def mm_to_pct(measured_mm: float, tread_new_mm: float) -> float:
    """Sulco medido → % de banda restante (1,6 mm, o mínimo legal, é 0%)."""
    return max(0.0, min(100.0, (measured_mm - LEGAL_MIN_TREAD_MM) / (tread_new_mm - LEGAL_MIN_TREAD_MM) * 100))


def pct_to_mm(pct: float, tread_new_mm: float) -> float:
    return LEGAL_MIN_TREAD_MM + pct / 100 * (tread_new_mm - LEGAL_MIN_TREAD_MM)


def vehicle_tires(db: Session, vehicle_id: int) -> list[Tire]:
    tires = db.scalars(select(Tire).where(Tire.vehicle_id == vehicle_id)).all()
    return sorted(tires, key=lambda t: TIRE_POSITIONS.index(t.position))


# ---------- planejamento ----------

def base_point(db: Session, company_id: int) -> tuple[float, float] | None:
    base = company_base(db.get(Company, company_id))
    return (base.latitude, base.longitude) if base else None


def _last_tracker_position(db: Session, vehicle_id: int, since: datetime | None = None) -> Position | None:
    q = select(Position).where(Position.vehicle_id == vehicle_id)
    if since:
        q = q.where(Position.recorded_at >= since)
    return db.scalar(q.order_by(Position.recorded_at.desc()).limit(1))


def _day_deliveries(db: Session, driver_id: int, day: date) -> list[Delivery]:
    q = select(Delivery).where(Delivery.driver_id == driver_id, Delivery.scheduled_for == day)
    return list(db.scalars(q.order_by(Delivery.stop_order, Delivery.id)))


def _apply_plan(db: Session, run: DeliveryRun, origin: tuple[float, float] | None, end: tuple[float, float] | None) -> None:
    """Localiza as entregas que faltam, calcula a melhor ordem e renumera as paradas.
    Entregas que não deu para localizar vão para o fim, na ordem que estavam."""
    deliveries = _day_deliveries(db, run.driver_id, run.day)
    done = [d for d in deliveries if d.status in DONE]
    todo = [d for d in deliveries if d.status not in DONE]

    located: list[tuple[Delivery, geocoding.Location]] = []
    missing: list[Delivery] = []
    for d in todo:
        try:
            loc = geocoding.locate(db, d.address, d.city, near=origin or end)
        except geocoding.GeocodingError as e:
            log.warning("Não consegui localizar a entrega %s: %s", d.id, e)
            loc = None
        if loc:
            located.append((d, loc))
        else:
            missing.append(d)

    plan = routing.plan_route(origin, [(loc.latitude, loc.longitude) for _, loc in located], end)
    ordered = [located[i] for i in plan.order]
    # As paradas que esta rota já resolveu continuam nela (com o lugar no mapa); depois vem a ordem calculada
    resolved_here = {d.id for d in done if d.run_id == run.id}
    kept = [p for p in run.plan if p["delivery_id"] in resolved_here]
    run.plan = kept + [
        {"delivery_id": d.id, "leg_km": leg, "latitude": loc.latitude, "longitude": loc.longitude, "precision": loc.precision}
        for (d, loc), leg in zip(ordered, plan.legs_km)
    ] + [{"delivery_id": d.id, "leg_km": None, "latitude": None, "longitude": None, "precision": None} for d in missing]
    run.geometry = plan.geometry
    run.origin_latitude, run.origin_longitude = origin if origin else (None, None)
    run.returns_to_base = end is not None and bool(located)
    run.planned_distance_km = plan.distance_km
    run.planned_duration_min = plan.duration_min
    run.optimized = plan.optimized

    # As já resolvidas continuam na frente; depois vem a ordem calculada
    for i, d in enumerate([*done, *(d for d, _ in ordered), *missing], start=1):
        d.stop_order = i

    # Preço fixo da rota pela região mais cara que ela atende
    regions.apply_to_run(db, run, [(d.city, loc.latitude, loc.longitude) for d, loc in located] + [(d.city, None, None) for d in missing])

    # O peso das entregas que entram nesta rota fica registrado nela
    joining = [d for d in todo if d.run_id != run.id]
    for d in joining:
        d.run_id = run.id
    run.load_kg = round((run.load_kg or 0) + sum(d.weight_kg for d in joining), 1)


def start_run(db: Session, driver: User, day: date, checklist_id: int | None = None) -> DeliveryRun:
    if db.scalar(select(DeliveryRun.id).where(DeliveryRun.driver_id == driver.id, DeliveryRun.status == RunStatus.active)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Você já tem uma rota em andamento. Encerre-a antes de começar outra.")
    vehicle = db.scalar(select(Vehicle).where(Vehicle.current_driver_id == driver.id).order_by(Vehicle.id).limit(1))
    if not vehicle:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cadastre seu veículo em “Meu veículo” antes de iniciar a rota.")
    if not any(d.status not in DONE for d in _day_deliveries(db, driver.id, day)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Não há entregas no seu caminhão para esse dia.")

    base = base_point(db, driver.company_id)
    origin = base
    if not origin and (last := _last_tracker_position(db, vehicle.id)):
        origin = (last.latitude, last.longitude)
    run = DeliveryRun(
        company_id=driver.company_id, driver_id=driver.id, vehicle_id=vehicle.id, day=day,
        status=RunStatus.active, started_at=_now(),
    )
    db.add(run)
    db.flush()
    _apply_plan(db, run, origin, base)
    if checklist_id:
        checklists.attach(db, run, checklist_id, driver)
    db.commit()
    return run


def current_position(db: Session, run: DeliveryRun) -> tuple[tuple[float, float], datetime] | None:
    """Última posição conhecida durante a rota: a mais recente entre o celular e o rastreador
    (com o rastreador simulado, só ele vale: o celular de quem testa não está no caminhão)."""
    tracker = _last_tracker_position(db, run.vehicle_id, since=run.started_at)
    if is_simulated(db, run.vehicle_id):
        return ((tracker.latitude, tracker.longitude), as_utc(tracker.recorded_at)) if tracker else None
    phone = db.scalar(select(RunPoint).where(RunPoint.run_id == run.id).order_by(RunPoint.recorded_at.desc()).limit(1))
    best = max((p for p in (phone, tracker) if p), key=lambda p: as_utc(p.recorded_at), default=None)
    return ((best.latitude, best.longitude), as_utc(best.recorded_at)) if best else None


def replan_run(db: Session, run: DeliveryRun) -> DeliveryRun:
    """Recalcula a partir de onde o caminhão está (ou da base) com as entregas que faltam, voltando à base."""
    base = base_point(db, run.company_id)
    here = current_position(db, run)
    origin = here[0] if here and _now() - here[1] <= FRESH_POSITION else base
    _apply_plan(db, run, origin, base)
    db.commit()
    return run


def active_pause(db: Session, run: DeliveryRun) -> RunPause | None:
    return db.scalar(select(RunPause).where(RunPause.run_id == run.id, RunPause.ended_at.is_(None)))


def start_pause(db: Session, run: DeliveryRun, kind: str) -> DeliveryRun:
    if active_pause(db, run):
        raise HTTPException(status.HTTP_409_CONFLICT, "Você já está em pausa. Retome a rota antes de começar outra pausa.")
    db.add(RunPause(run_id=run.id, kind=kind, started_at=_now()))
    db.commit()
    return run


def end_pause(db: Session, run: DeliveryRun) -> DeliveryRun:
    pause = active_pause(db, run)
    if not pause:
        raise HTTPException(status.HTTP_409_CONFLICT, "A rota não está em pausa.")
    pause.ended_at = _now()
    db.commit()
    return run


def finish_run(db: Session, run: DeliveryRun) -> DeliveryRun:
    if pause := active_pause(db, run):
        pause.ended_at = _now()
    km, source, _ = run_distance(db, run)
    run.distance_km, run.km_source = km, source
    run.status, run.finished_at = RunStatus.finished, _now()
    db.commit()
    return run


def add_points(db: Session, run: DeliveryRun, points: list[RunPointIn]) -> int:
    """Guarda as posições do celular. Descarta as imprecisas, as repetidas e as de fora da rota."""
    last = db.scalar(select(func.max(RunPoint.recorded_at)).where(RunPoint.run_id == run.id))
    last = as_utc(last) if last else None
    earliest, latest = as_utc(run.started_at) - EARLY_POINT, _now() + timedelta(minutes=5)
    accepted = 0
    for p in sorted(points, key=lambda p: p.recorded_at):
        at = as_utc(p.recorded_at)
        if not earliest <= at <= latest or (last and at <= last) or (p.accuracy_m or 0) > MAX_ACCURACY_M:
            continue
        db.add(RunPoint(run_id=run.id, recorded_at=at, latitude=p.latitude, longitude=p.longitude, accuracy_m=p.accuracy_m))
        last, accepted = at, accepted + 1
    db.commit()
    return accepted


def prefetch_locations(delivery_ids: list[int], near: tuple[float, float] | None) -> None:
    """Em segundo plano: localiza as entregas assim que vão para um caminhão,
    para o "Iniciar rota" não esperar o geocodificador."""
    with SessionLocal() as db:
        for d in db.scalars(select(Delivery).where(Delivery.id.in_(delivery_ids))):
            try:
                geocoding.locate(db, d.address, d.city, near=near)
            except geocoding.GeocodingError as e:
                log.warning("Não consegui localizar a entrega %s agora: %s", d.id, e)
                return


# ---------- respostas ----------

def _pause_out(p: RunPause) -> PauseOut:
    return PauseOut(id=p.id, kind=p.kind, started_at=as_utc(p.started_at), ended_at=as_utc(p.ended_at) if p.ended_at else None)


def _summary_fields(db: Session, run: DeliveryRun, km: float | None, source: str | None) -> dict:
    pause = active_pause(db, run)
    return dict(
        id=run.id, driver_id=run.driver_id, vehicle_id=run.vehicle_id, day=run.day, status=run.status,
        started_at=as_utc(run.started_at), finished_at=as_utc(run.finished_at) if run.finished_at else None,
        planned_distance_km=run.planned_distance_km, distance_km=km or 0.0, km_source=source,
        active_pause=_pause_out(pause) if pause else None, load_kg=run.load_kg,
        region_name=run.region_name, region_price=run.region_price_cents / 100 if run.region_price_cents is not None else None,
        checklist=checklists.brief(db, run.id),
    )


def run_summary(db: Session, run: DeliveryRun) -> RunSummary:
    km, source = (run.distance_km, run.km_source) if run.status == RunStatus.finished else run_distance(db, run)[:2]
    return RunSummary(**_summary_fields(db, run, km, source))


def downsample(points: Sequence, limit: int) -> list:
    if len(points) <= limit:
        return list(points)
    step = len(points) / limit
    return [points[int(i * step)] for i in range(limit - 1)] + [points[-1]]


def run_out(db: Session, run: DeliveryRun) -> RunOut:
    km, source, trail = run_distance(db, run)
    if run.status == RunStatus.finished and run.distance_km is not None:
        km, source = run.distance_km, run.km_source

    deliveries = {d.id: d for d in _day_deliveries(db, run.driver_id, run.day)}
    proofs = {d.id: d for d in with_proofs(db, deliveries.values())}
    stops: list[RunStop] = []
    planned_ids = set()
    for p in run.plan:
        d = deliveries.get(p["delivery_id"])
        if not d or d.run_id not in (None, run.id):
            continue  # o gestor tirou do caminhão depois do cálculo, ou ela seguiu numa rota seguinte
        planned_ids.add(d.id)
        stops.append(RunStop(
            order=len(stops) + 1, delivery=proofs[d.id], latitude=p["latitude"], longitude=p["longitude"],
            precision=p["precision"], leg_km=p["leg_km"], planned=True,
        ))
    # Entrega que chegou depois do cálculo (só enquanto a rota está em andamento: depois, ela é da próxima rota)
    for d in deliveries.values() if run.status == RunStatus.active else ():
        if d.id not in planned_ids and d.status not in DONE:
            stops.append(RunStop(
                order=len(stops) + 1, delivery=proofs[d.id], latitude=None, longitude=None,
                precision=None, leg_km=None, planned=False,
            ))
    # Mudou se chegou entrega que não estava no cálculo ou se alguma do cálculo saiu do caminhão
    plan_ids = {p["delivery_id"] for p in run.plan}
    pending_ids = {d.id for d in deliveries.values() if d.status not in DONE}
    needs_replan = run.status == RunStatus.active and bool(pending_ids - plan_ids or plan_ids - deliveries.keys())

    here = current_position(db, run)
    vehicle = db.get(Vehicle, run.vehicle_id)
    rolling = [t for t in vehicle_tires(db, run.vehicle_id) if t.position != SPARE_POSITION]
    vehicle_km = vehicle_route_km(db, run.vehicle_id)
    estimates = [tire_out(t, vehicle_km) for t in rolling]
    legs = [p["leg_km"] for p in run.plan if p["leg_km"] is not None]

    pauses = db.scalars(select(RunPause).where(RunPause.run_id == run.id).order_by(RunPause.started_at))
    return RunOut(
        **_summary_fields(db, run, km, source),
        pauses=[_pause_out(p) for p in pauses],
        plate=vehicle.plate if vehicle else "",
        origin=(run.origin_latitude, run.origin_longitude) if run.origin_latitude is not None else None,
        returns_to_base=run.returns_to_base,
        return_km=round(run.planned_distance_km - sum(legs), 1) if run.returns_to_base and run.planned_distance_km else None,
        planned_duration_min=run.planned_duration_min,
        optimized=run.optimized,
        geometry=[tuple(p) for p in run.geometry],
        stops=stops,
        trail=[(p.latitude, p.longitude) for p in downsample(trail, MAX_TRAIL_POINTS)],
        current_position=here[0] if here else None,
        position_at=here[1] if here else None,
        needs_replan=needs_replan,
        simulated=is_simulated(db, run.vehicle_id),
        tire_wear_pct=round(sum((km or 0) / t.life_km * 100 for t in rolling) / len(rolling), 4) if rolling else None,
        worst_tire=min(estimates, key=lambda t: t.estimated_pct) if estimates else None,
    )


def history(db: Session, user: User, date_from: date, date_to: date, driver_id: int | None) -> list[RunHistory]:
    """Rotas do período, cada uma com as entregas que levou (e os comprovantes), o valor e se já foi pago."""
    if user.role == UserRole.driver:
        driver_id = user.id
    q = select(DeliveryRun).where(DeliveryRun.company_id == user.company_id, DeliveryRun.day.between(date_from, date_to))
    if driver_id:
        q = q.where(DeliveryRun.driver_id == driver_id)
    found = list(db.scalars(q.order_by(DeliveryRun.started_at)))
    if not found:
        return []

    # Rota 1, 2… de cada motorista no dia
    index: dict[int, int] = {}
    seen: dict[tuple[int, date], int] = {}
    for r in found:
        seen[(r.driver_id, r.day)] = seen.get((r.driver_id, r.day), 0) + 1
        index[r.id] = seen[(r.driver_id, r.day)]

    by_run: dict[int, list[Delivery]] = {r.id: [] for r in found}
    for d in db.scalars(select(Delivery).where(Delivery.run_id.in_(by_run))):
        by_run[d.run_id].append(d)
    # Rotas de antes do vínculo entrega↔rota: as entregas do plano
    legacy = {r.id: [p["delivery_id"] for p in r.plan] for r in found if not by_run[r.id] and r.load_kg is None}
    if legacy:
        ids = {i for plan in legacy.values() for i in plan}
        loose = {d.id: d for d in db.scalars(select(Delivery).where(Delivery.id.in_(ids)))}
        for run_id, plan in legacy.items():
            by_run[run_id] = [loose[i] for i in plan if i in loose]

    proofs = {d.id: d for d in with_proofs(db, [d for items in by_run.values() for d in items])}
    names = dict(db.execute(select(User.id, User.name).where(User.id.in_({r.driver_id for r in found}))).all())
    plates = dict(db.execute(select(Vehicle.id, Vehicle.plate).where(Vehicle.id.in_({r.vehicle_id for r in found}))).all())
    payments = {p.id: p for p in db.scalars(select(DriverPayment).where(DriverPayment.id.in_({r.payment_id for r in found if r.payment_id})))}
    spent: dict[int, list[RouteExpense]] = {}
    for e in db.scalars(select(RouteExpense).where(RouteExpense.run_id.in_(by_run)).order_by(RouteExpense.spent_at)):
        spent.setdefault(e.run_id, []).append(e)

    out = []
    for r in sorted(found, key=lambda r: (r.day, r.started_at), reverse=True):
        order = {p["delivery_id"]: i for i, p in enumerate(r.plan)}
        items = sorted(by_run[r.id], key=lambda d: (order.get(d.id, len(order)), d.stop_order or 0))
        payment = payments.get(r.payment_id) if r.payment_id else None
        out.append(RunHistory(
            **run_summary(db, r).model_dump(), day_index=index[r.id], driver_name=names.get(r.driver_id),
            plate=plates.get(r.vehicle_id, ""), stops=[proofs[d.id] for d in items],
            payment=RunPayment(amount=payment.amount_cents / 100, status=payment.status, paid_on=payment.paid_on) if payment else None,
            expenses=[expense_brief(e) for e in spent.get(r.id, [])],
        ))
    return out


def with_proofs(db: Session, deliveries) -> list[DeliveryOut]:
    """Entregas com o comprovante mais recente de cada uma."""
    deliveries = list(deliveries)
    latest: dict[int, DeliveryProof] = {}
    active_runs: set[int] = set()
    if deliveries:
        q = select(DeliveryProof).where(DeliveryProof.delivery_id.in_([d.id for d in deliveries])).order_by(DeliveryProof.id)
        latest = {p.delivery_id: p for p in db.scalars(q)}
        run_ids = {d.run_id for d in deliveries if d.run_id}
        active_runs = set(db.scalars(select(DeliveryRun.id).where(DeliveryRun.id.in_(run_ids), DeliveryRun.status == RunStatus.active)))
    return [
        DeliveryOut.model_validate(d).model_copy(update={"proof": proof_out(latest.get(d.id)), "on_board": on_board(d, active_runs)})
        for d in deliveries
    ]


def on_board(d: Delivery, active_runs: set[int]) -> bool:
    """Ainda no caminhão: a entregar, ou não recebida enquanto a rota não voltou para a base (encerrada)."""
    return d.status == DeliveryStatus.assigned or (d.status == DeliveryStatus.failed and d.run_id in active_runs)


def release(db: Session, delivery: Delivery) -> None:
    """A entrega saiu do caminhão pelo carregamento (voltou para a fila ou foi para outro motorista):
    se a rota dela ainda está em andamento, o peso sai da rota."""
    if delivery.run_id:
        run = db.get(DeliveryRun, delivery.run_id)
        if run and run.status == RunStatus.active and delivery.status != DeliveryStatus.delivered:
            run.load_kg = round(max(0.0, (run.load_kg or 0) - delivery.weight_kg), 1)
    delivery.run_id = None


def proof_out(proof: DeliveryProof | None) -> ProofOut | None:
    if not proof:
        return None
    return ProofOut.model_validate(proof).model_copy(update={"created_at": as_utc(proof.created_at), "has_signature": bool(proof.signature_path)})


def admin_ids(db: Session, company_id: int) -> list[int]:
    q = select(User.id).where(User.company_id == company_id, User.role == UserRole.admin, User.active.is_(True))
    return list(db.scalars(q))
