"""Rastreador simulado (opções de desenvolvedor).

Anda com o veículo pela rota em andamento como se fosse o rastreador: grava posições (com hodômetro) ao longo do
traçado planejado, para em cada entrega até o motorista registrar o que aconteceu e volta para a base. Sem rota,
fica parado na base mandando uma posição de tempos em tempos, como um rastreador de verdade.

Roda dentro da API (ver app.main): um laço chama tick_all a cada poucos segundos e manda pelo WebSocket os avisos
para o mapa do gestor e a tela do motorista atualizarem na hora.
"""

import asyncio
import bisect
import hashlib
import json
import logging
import math
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import (
    Delivery,
    DeliveryProof,
    DeliveryRun,
    DeliveryStatus,
    FuelEntry,
    Position,
    RouteExpense,
    VehicleChecklist,
    RunPause,
    RunPoint,
    RunStatus,
    TrackerSimulation,
    User,
    Vehicle,
)
from app.services import checklists, payments, runs, uploads
from app.services.geo import as_utc, haversine_km

log = logging.getLogger(__name__)

# O laço e as telas de controle mexem na mesma simulação: um de cada vez
lock = threading.Lock()

# Depois de o servidor ficar parado (reinício, notebook dormindo), não "teleporta" o veículo
MAX_STEP_S = 10.0
# Sem rota, o rastreador manda uma posição a cada 5 min; parado durante a rota, a cada 30 s
IDLE_EVERY = timedelta(minutes=5)
STOPPED_EVERY = timedelta(seconds=30)
# Reduz a velocidade perto das paradas (saindo e chegando)
SLOW_ZONE_M = 150.0
MIN_KMH = 12.0
# Motorista automático: espera 1 min (simulado) na base antes de encerrar a rota
BASE_WAIT_S = 60.0
ARRIVED_M = 0.5
DONE = runs.DONE

PHASE_TEXT = {
    "idle": "Sem rota: parado",
    "driving": "Indo para a próxima entrega",
    "at_stop": "Parado na entrega",
    "returning": "Voltando para a base",
    "at_base": "De volta à base",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------- traçado ----------

@dataclass
class Track:
    """Traçado da rota com a distância acumulada e onde fica cada parada (metros desde o início)."""

    points: list[tuple[float, float]]
    cum: list[float]
    stops: list[tuple[int, float]] = field(default_factory=list)  # (delivery_id, metros), na ordem do plano

    @property
    def length(self) -> float:
        return self.cum[-1]

    def at(self, m: float) -> tuple[float, float]:
        m = min(max(m, 0.0), self.length)
        i = min(bisect.bisect_right(self.cum, m) - 1, len(self.points) - 2)
        seg = self.cum[i + 1] - self.cum[i]
        f = (m - self.cum[i]) / seg if seg else 0.0
        (a_lat, a_lon), (b_lat, b_lon) = self.points[i], self.points[i + 1]
        return round(a_lat + (b_lat - a_lat) * f, 7), round(a_lon + (b_lon - a_lon) * f, 7)


def _project(track: Track, target: tuple[float, float], lo: float, hi: float) -> float | None:
    """Ponto do traçado mais perto do alvo entre lo e hi metros do início. O traçado pode passar mais de uma vez
    perto do mesmo lugar: a janela em volta de onde a parada deveria estar evita pegar a passagem errada."""
    kx, ky = 111_320 * math.cos(math.radians(target[0])), 110_540
    tx, ty = target[1] * kx, target[0] * ky
    best: tuple[float, float] | None = None
    for i in range(len(track.points) - 1):
        if track.cum[i + 1] < lo or track.cum[i] > hi:
            continue
        ax, ay = track.points[i][1] * kx, track.points[i][0] * ky
        bx, by = track.points[i + 1][1] * kx, track.points[i + 1][0] * ky
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((tx - ax) * dx + (ty - ay) * dy) / seg2))
        d = math.hypot(ax + t * dx - tx, ay + t * dy - ty)
        m = min(max(track.cum[i] + t * (track.cum[i + 1] - track.cum[i]), lo), hi)
        if best is None or d < best[0]:
            best = (d, m)
    return best[1] if best else None


def build_track(run: DeliveryRun) -> Track | None:
    points = [(float(lat), float(lon)) for lat, lon in run.geometry or []]
    if len(points) < 2:
        return None
    cum = [0.0]
    for a, b in zip(points, points[1:]):
        cum.append(cum[-1] + haversine_km(*a, *b) * 1000)
    track = Track(points, cum)
    if track.length <= 0:
        return None
    # Onde cada parada deveria estar pelos km de cada trecho (corrigidos para o tamanho do traçado desenhado)
    scale = track.length / (run.planned_distance_km * 1000) if run.planned_distance_km else 1.0
    expected = prev = 0.0
    for p in run.plan:
        if p.get("latitude") is None:
            continue  # não localizada: não dá para ir até ela
        expected += (p.get("leg_km") or 0) * 1000 * scale
        tolerance = 300 + 0.05 * expected
        lo, hi = max(prev, expected - tolerance), min(track.length, expected + tolerance)
        m = _project(track, (p["latitude"], p["longitude"]), lo, hi) if lo <= hi else None
        prev = max(prev, m if m is not None else min(max(expected, prev), track.length))
        track.stops.append((p["delivery_id"], prev))
    return track


def plan_key(run: DeliveryRun) -> str:
    raw = json.dumps([run.id, run.geometry, [p["delivery_id"] for p in run.plan]], separators=(",", ":"))
    return hashlib.md5(raw.encode()).hexdigest()


_tracks: dict[str, Track | None] = {}


def track_for(run: DeliveryRun) -> tuple[str, Track | None]:
    key = plan_key(run)
    if key not in _tracks:
        if len(_tracks) > 32:
            _tracks.clear()
        _tracks[key] = build_track(run)
    return key, _tracks[key]


# ---------- avisos ----------

class Events:
    """Avisos para mandar pelo WebSocket depois de gravar: (destinatários, mensagem), sem repetir."""

    def __init__(self) -> None:
        self.items: list[tuple[list[int], dict]] = []

    def add(self, user_ids: list[int], payload: dict) -> None:
        ids = sorted({u for u in user_ids if u})
        if ids and (ids, payload) not in self.items:
            self.items.append((ids, payload))


def recipients(db: Session, vehicle: Vehicle) -> list[int]:
    """Quem acompanha o veículo: os gestores da empresa e o motorista dele."""
    return runs.admin_ids(db, vehicle.company_id) + ([vehicle.current_driver_id] if vehicle.current_driver_id else [])


async def send(events: list[tuple[list[int], dict]]) -> None:
    from app.services import notify  # evita import circular (notify → push → banco)

    await notify.send(events)


# ---------- movimento ----------

def _due(sim: TrackerSimulation, now: datetime, every: timedelta) -> bool:
    return sim.last_position_at is None or now - as_utc(sim.last_position_at) >= every


def _emit(db: Session, sim: TrackerSimulation, vehicle: Vehicle, now: datetime, speed_kmh: float, ignition: bool) -> None:
    db.add(Position(
        vehicle_id=vehicle.id, driver_id=vehicle.current_driver_id, recorded_at=now,
        latitude=sim.latitude, longitude=sim.longitude, speed_kmh=round(speed_kmh, 1), ignition=ignition,
        odometer_km=round(sim.odometer_km, 3), simulated=True,
    ))
    sim.last_position_at = now


def _statuses(db: Session, run: DeliveryRun) -> dict[int, DeliveryStatus]:
    q = select(Delivery.id, Delivery.status).where(Delivery.driver_id == run.driver_id, Delivery.scheduled_for == run.day)
    return dict(db.execute(q).all())


def next_target(track: Track, statuses: dict[int, DeliveryStatus], progress_m: float) -> tuple[int | None, float]:
    """Próxima entrega a fazer pela ordem da rota (as já resolvidas ficam para trás) ou, sem nenhuma, o fim (a base)."""
    for delivery_id, m in track.stops:
        if delivery_id in statuses and statuses[delivery_id] not in DONE and m >= progress_m - ARRIVED_M:
            return delivery_id, m
    return None, track.length


def _speed(sim: TrackerSimulation, track: Track, target_m: float) -> float:
    """Velocidade média com variação (sinais, trânsito) e mais devagar perto das paradas."""
    left_at = max([m for _, m in track.stops if m <= sim.progress_m + ARRIVED_M] + [0.0])
    near = min(sim.progress_m - left_at, target_m - sim.progress_m)
    wave = 1 + 0.15 * math.sin(sim.progress_m / 350)
    ramp = min(1.0, (near + 30) / SLOW_ZONE_M)
    return max(MIN_KMH, sim.cruise_kmh * wave * ramp)


def _base(db: Session, company_id: int) -> tuple[float, float] | None:
    return runs.base_point(db, company_id)


def _set_phase(sim: TrackerSimulation, phase: str, events: Events, to: list[int]) -> None:
    if sim.phase != phase:
        sim.phase = phase
        events.add(to, {"type": "simulation", "vehicle_id": sim.vehicle_id})


def _arrive(db: Session, sim: TrackerSimulation, run: DeliveryRun, target_id: int | None, events: Events, to: list[int]) -> None:
    sim.stopped_s = 0.0
    if target_id is not None:
        sim.stop_delivery_id = target_id
        _set_phase(sim, "at_stop", events, to)
        return
    sim.stop_delivery_id = None
    # Estaciona no pátio: o traçado termina na rua mais próxima da base
    if run.returns_to_base and (base := _base(db, run.company_id)):
        sim.latitude, sim.longitude = base
    _set_phase(sim, "at_base", events, to)


def _idle(db: Session, sim: TrackerSimulation, vehicle: Vehicle, now: datetime, events: Events, to: list[int]) -> None:
    changed = sim.run_id is not None
    sim.run_id = sim.plan_key = sim.stop_delivery_id = None
    _set_phase(sim, "idle", events, to)
    if sim.latitude is None and (base := _base(db, vehicle.company_id)):
        sim.latitude, sim.longitude = base
        changed = True
    if sim.latitude is not None and (changed or _due(sim, now, IDLE_EVERY)):
        _emit(db, sim, vehicle, now, 0, False)
        events.add(to, {"type": "positions", "vehicle_id": vehicle.id})


def tick(db: Session, sim: TrackerSimulation, now: datetime, events: Events) -> None:
    last = as_utc(sim.last_tick_at) if sim.last_tick_at else now
    real_s = min(max((now - last).total_seconds(), 0.0), MAX_STEP_S)
    sim.last_tick_at = now
    vehicle = db.get(Vehicle, sim.vehicle_id)
    to = recipients(db, vehicle)
    run = db.scalar(select(DeliveryRun).where(DeliveryRun.vehicle_id == vehicle.id, DeliveryRun.status == RunStatus.active))
    key, track = track_for(run) if run else (None, None)
    if not run or not track:
        _idle(db, sim, vehicle, now, events, to)
        return

    moved = {"type": "positions", "vehicle_id": vehicle.id}
    if (sim.run_id, sim.plan_key) != (run.id, key):
        # Rota nova ou recalculada: o traçado começa onde o caminhão está (a base, ou a posição ao recalcular)
        sim.run_id, sim.plan_key = run.id, key
        sim.progress_m, sim.stopped_s, sim.stop_delivery_id = 0.0, 0.0, None
        sim.latitude, sim.longitude = track.at(0)
        _set_phase(sim, "driving", events, to)
        _emit(db, sim, vehicle, now, 0, True)
        events.add(to, moved)
        return

    def stopped() -> None:
        if _due(sim, now, STOPPED_EVERY):
            _emit(db, sim, vehicle, now, 0, False)
            events.add(to, moved)

    if sim.paused:
        stopped()
        return
    dt = real_s * sim.speed_factor
    statuses = _statuses(db, run)

    if sim.phase == "at_stop":
        sim.stopped_s += dt
        delivery_id = sim.stop_delivery_id
        pending = delivery_id in statuses and statuses[delivery_id] not in DONE
        dwell = sim.dwell_min * 60
        if pending and sim.auto_driver and sim.stopped_s >= dwell:
            auto_deliver(db, run, vehicle, delivery_id, sim, events)
            statuses[delivery_id], pending = DeliveryStatus.delivered, False
        if pending or sim.stopped_s < dwell:
            stopped()  # espera o motorista registrar a entrega (e o tempo mínimo de descarga)
            return
        sim.stop_delivery_id = None  # entrega resolvida: segue viagem

    if sim.phase == "at_base":
        sim.stopped_s += dt
        if sim.auto_driver and sim.stopped_s >= BASE_WAIT_S:
            runs.finish_run(db, run)
            if payment := payments.launch_for_run(db, run):
                for user_ids, payload in payments.events(db, [payment], "created"):
                    events.add(user_ids, payload)
            sim.run_id = sim.plan_key = None
            _set_phase(sim, "idle", events, to)
            events.add(to, {"type": "run_changed"})
            _emit(db, sim, vehicle, now, 0, False)
            events.add(to, moved)
            return
        stopped()
        return

    target_id, target_m = next_target(track, statuses, sim.progress_m)
    _set_phase(sim, "driving" if target_id is not None else "returning", events, to)
    remaining = target_m - sim.progress_m
    speed = _speed(sim, track, target_m)
    if remaining > ARRIVED_M:
        step = min(remaining, speed / 3.6 * dt)
        sim.progress_m += step
        sim.odometer_km += step / 1000
        sim.latitude, sim.longitude = track.at(sim.progress_m)
        remaining -= step
    if remaining <= ARRIVED_M:
        _arrive(db, sim, run, target_id, events, to)
        _emit(db, sim, vehicle, now, 0, False)
    else:
        _emit(db, sim, vehicle, now, speed, True)
    events.add(to, moved)


def tick_all(db: Session, now: datetime | None = None) -> list[tuple[list[int], dict]]:
    """Um passo de todas as simulações. Devolve os avisos para mandar pelo WebSocket."""
    now = now or _now()
    events = Events()
    for sim in db.scalars(select(TrackerSimulation)).all():
        tick(db, sim, now, events)
    db.commit()
    return events.items


def tick_once() -> list[tuple[list[int], dict]]:
    with lock, SessionLocal() as db:
        return tick_all(db)


async def run_loop(interval_s: float) -> None:
    """Laço da API: anda com os veículos simulados e avisa as telas."""
    while True:
        await asyncio.sleep(interval_s)
        try:
            events = await asyncio.to_thread(tick_once)
        except Exception:  # um erro num passo não pode parar a simulação
            log.exception("Falha no rastreador simulado")
            continue
        await send(events)


# ---------- motorista automático ----------

def _proof_svg(customer: str, when: datetime) -> str:
    local = when.astimezone(ZoneInfo(get_settings().timezone)).strftime("%d/%m/%Y às %H:%M")
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">'
        '<rect width="800" height="600" fill="#f2f2f2"/>'
        '<rect x="40" y="40" width="720" height="520" rx="16" fill="#fff" stroke="#d9d9d9" stroke-width="2"/>'
        '<circle cx="400" cy="200" r="70" fill="#1e8e3e"/>'
        '<path d="M360 200l28 28 52-56" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>'
        '<g font-family="Arial, sans-serif" text-anchor="middle">'
        '<text x="400" y="340" font-size="34" font-weight="700" fill="#222">Comprovante simulado</text>'
        f'<text x="400" y="395" font-size="26" fill="#222">{escape(customer[:48])}</text>'
        f'<text x="400" y="440" font-size="22" fill="#666">Entregue em {local}</text>'
        '<text x="400" y="500" font-size="18" fill="#999">Motorista automático · opções de desenvolvedor do FrotaGest</text>'
        "</g></svg>"
    )


def auto_deliver(db: Session, run: DeliveryRun, vehicle: Vehicle, delivery_id: int, sim: TrackerSimulation, events: Events) -> None:
    """Faz o que o motorista faria no endereço: registra a entrega com uma foto (gerada) e avisa o gestor."""
    delivery = db.get(Delivery, delivery_id)
    driver = db.get(User, run.driver_id)
    relative = f"proofs/{run.company_id}/{uuid.uuid4().hex}.svg"
    path = Path(get_settings().upload_dir) / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_proof_svg(delivery.customer_name, _now()), encoding="utf-8")
    db.add(DeliveryProof(
        delivery_id=delivery.id, company_id=run.company_id, driver_id=run.driver_id, outcome="delivered",
        note="Confirmada pelo motorista automático (simulação).", photo_path=relative,
        latitude=sim.latitude, longitude=sim.longitude,
    ))
    delivery.status = DeliveryStatus.delivered
    notice = {
        "delivery_id": delivery.id, "customer_name": delivery.customer_name, "driver_name": driver.name,
        "outcome": "delivered", "reason": None,
    }
    events.add(runs.admin_ids(db, run.company_id), {"type": "delivery_outcome", "data": notice})
    events.add([run.driver_id], {"type": "deliveries_changed"})


# ---------- controles (opções de desenvolvedor) ----------

def _active_run(db: Session, vehicle_id: int) -> DeliveryRun | None:
    return db.scalar(select(DeliveryRun).where(DeliveryRun.vehicle_id == vehicle_id, DeliveryRun.status == RunStatus.active))


def start(db: Session, vehicle: Vehicle) -> TrackerSimulation:
    """Liga o rastreador simulado: o veículo aparece na base (ou onde estava) e segue a rota quando ela começar."""
    sim = TrackerSimulation(
        vehicle_id=vehicle.id, company_id=vehicle.company_id, speed_factor=10, cruise_kmh=40, dwell_min=3,
        auto_driver=False, paused=False, phase="idle", progress_m=0, odometer_km=0, stopped_s=0,
    )
    last = db.scalar(select(Position).where(Position.vehicle_id == vehicle.id).order_by(Position.recorded_at.desc()).limit(1))
    if last and last.odometer_km is not None:
        sim.odometer_km = last.odometer_km  # continua o hodômetro do rastreador
    db.add(sim)
    return sim


def skip(db: Session, sim: TrackerSimulation, events: Events) -> None:
    """Leva o veículo direto até a próxima entrega (ou até a base), somando os km do caminho."""
    vehicle = db.get(Vehicle, sim.vehicle_id)
    run = _active_run(db, vehicle.id)
    key, track = track_for(run) if run else (None, None)
    if not run or not track or (sim.run_id, sim.plan_key) != (run.id, key):
        raise HTTPException(status.HTTP_409_CONFLICT, "O motorista ainda não iniciou a rota (ou ela acabou de ser recalculada).")
    if sim.phase == "at_stop":
        raise HTTPException(status.HTTP_409_CONFLICT, "O veículo está parado numa entrega: registre a entrega no app do motorista.")
    if sim.phase == "at_base":
        raise HTTPException(status.HTTP_409_CONFLICT, "O veículo já voltou para a base: encerre a rota no app do motorista.")
    target_id, target_m = next_target(track, _statuses(db, run), sim.progress_m)
    sim.odometer_km += max(0.0, target_m - sim.progress_m) / 1000
    sim.progress_m = target_m
    sim.latitude, sim.longitude = track.at(target_m)
    to = recipients(db, vehicle)
    _arrive(db, sim, run, target_id, events, to)
    now = _now()
    sim.last_tick_at = now
    _emit(db, sim, vehicle, now, 0, False)
    events.add(to, {"type": "positions", "vehicle_id": vehicle.id})


def reset(db: Session, sim: TrackerSimulation) -> dict[str, int]:
    """Recomeça o teste do dia: apaga as rotas de hoje do veículo e as posições simuladas, devolve as entregas
    resolvidas hoje para o caminhão (sem os comprovantes) e leva o veículo de volta para a base."""
    vehicle = db.get(Vehicle, sim.vehicle_id)
    today = datetime.now(ZoneInfo(get_settings().timezone)).date()
    run_ids = select(DeliveryRun.id).where(DeliveryRun.vehicle_id == vehicle.id, DeliveryRun.day == today)
    priced = set(db.scalars(select(DeliveryRun.payment_id).where(DeliveryRun.id.in_(run_ids), DeliveryRun.payment_id.is_not(None))))
    db.execute(update(Delivery).where(Delivery.run_id.in_(run_ids)).values(run_id=None))
    # O que foi registrado nas rotas de teste sai junto: checklists, abastecimentos e despesas (com o reembolso a receber)
    for c in db.scalars(select(VehicleChecklist).where(VehicleChecklist.run_id.in_(run_ids))):
        uploads.remove(*checklists.photos(c))
        db.delete(c)
    for f in db.scalars(select(FuelEntry).where(FuelEntry.run_id.in_(run_ids))):
        uploads.remove(f.photo_path)
        db.delete(f)
    for e in db.scalars(select(RouteExpense).where(RouteExpense.run_id.in_(run_ids))):
        uploads.remove(e.photo_path)
        if e.payment_id:
            priced.add(e.payment_id)
        db.delete(e)
    db.flush()
    db.execute(delete(RunPoint).where(RunPoint.run_id.in_(run_ids)))
    db.execute(delete(RunPause).where(RunPause.run_id.in_(run_ids)))
    run_count = db.execute(delete(DeliveryRun).where(DeliveryRun.vehicle_id == vehicle.id, DeliveryRun.day == today)).rowcount
    payments.drop_empty(db, priced)  # valores a pagar só dessas rotas de teste (e reembolsos delas)

    deliveries: list[Delivery] = []
    if vehicle.current_driver_id:
        deliveries = list(db.scalars(select(Delivery).where(
            Delivery.driver_id == vehicle.current_driver_id, Delivery.scheduled_for == today, Delivery.status.in_(DONE),
        )))
    for proof in db.scalars(select(DeliveryProof).where(DeliveryProof.delivery_id.in_([d.id for d in deliveries]))):
        uploads.remove(proof.photo_path, proof.signature_path)
        db.delete(proof)
    for d in deliveries:
        d.status = DeliveryStatus.assigned
    positions = db.execute(delete(Position).where(Position.vehicle_id == vehicle.id, Position.simulated.is_(True))).rowcount

    sim.run_id = sim.plan_key = sim.stop_delivery_id = None
    sim.phase, sim.progress_m, sim.stopped_s = "idle", 0.0, 0.0
    sim.latitude, sim.longitude = _base(db, vehicle.company_id) or (None, None)
    sim.last_position_at = None  # o próximo passo já mostra o veículo na base
    return {"runs": run_count, "deliveries": len(deliveries), "positions": positions}


def describe(db: Session, sim: TrackerSimulation) -> dict:
    """Situação da simulação para a tela de opções de desenvolvedor."""
    vehicle = db.get(Vehicle, sim.vehicle_id)
    driver = db.get(User, vehicle.current_driver_id) if vehicle.current_driver_id else None
    run = _active_run(db, vehicle.id)
    key, track = track_for(run) if run else (None, None)
    following = bool(run and track and (sim.run_id, sim.plan_key) == (run.id, key))
    stop = None
    stops_total = stops_done = 0
    if run and track:
        statuses = _statuses(db, run)
        planned = [d_id for d_id, _ in track.stops if d_id in statuses]
        stops_total, stops_done = len(planned), sum(1 for d_id in planned if statuses[d_id] in DONE)
        target_id = sim.stop_delivery_id if sim.phase == "at_stop" else next_target(track, statuses, sim.progress_m)[0]
        if target_id is not None and (delivery := db.get(Delivery, target_id)):
            stop = {
                "delivery_id": delivery.id, "customer_name": delivery.customer_name,
                "order": planned.index(target_id) + 1 if target_id in planned else None,
                "resolved": delivery.status in DONE,
            }
    return dict(
        vehicle_id=vehicle.id, plate=vehicle.plate, driver_name=driver.name if driver else None,
        speed_factor=sim.speed_factor, cruise_kmh=sim.cruise_kmh, dwell_min=sim.dwell_min,
        auto_driver=sim.auto_driver, paused=sim.paused, phase=sim.phase, phase_text=PHASE_TEXT.get(sim.phase, sim.phase),
        run_id=run.id if run else None, following=following,
        progress_km=round(sim.progress_m / 1000, 2) if following else 0.0,
        route_km=round(track.length / 1000, 2) if track else None,
        stops_total=stops_total, stops_done=stops_done, stop=stop,
        latitude=sim.latitude, longitude=sim.longitude,
    )
