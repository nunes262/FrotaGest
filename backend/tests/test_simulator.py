"""Rastreador simulado (opções de desenvolvedor): anda pela rota, para nas entregas e volta para a base."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, func, select

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import Company, DeliveryRun, Position, TrackerSimulation
from app.services import simulator
from app.services.geo import haversine_km
from app.workers.poller import sync_company
from tests.conftest import login

PHOTO = ("canhoto.jpg", b"\xff\xd8\xff\xe0 foto de teste", "image/jpeg")
NEAR_STOP_KM = 0.3  # o mesmo raio do "Você chegou" no app do motorista


def _joao(client, admin_headers, driver_headers):
    me = client.get("/api/auth/me", headers=driver_headers).json()
    vehicle = next(v for v in client.get("/api/vehicles", headers=admin_headers).json() if v["current_driver_id"] == me["id"])
    return me, vehicle


def _assign(client, admin_headers, driver_id, customers):
    pending = {d["customer_name"]: d for d in client.get("/api/deliveries", headers=admin_headers).json()}
    ids = [pending[c]["id"] for c in customers]
    assert client.post("/api/deliveries/assign", json={"delivery_ids": ids, "driver_id": driver_id}, headers=admin_headers).status_code == 200
    return pending[customers[0]]["scheduled_for"]


class Clock:
    """Passos de 10 s no passado recente: as posições precisam cair entre o início da rota e agora.
    Os controles das opções de desenvolvedor (pular parada) gravam no mesmo relógio, 1 s depois do último passo."""

    def __init__(self, start: datetime, monkeypatch):
        self.t = start
        monkeypatch.setattr(simulator, "_now", lambda: self.t + timedelta(seconds=1))

    def tick(self, times: int = 1) -> list:
        events = []
        for _ in range(times):
            self.t += timedelta(seconds=10)
            assert self.t <= datetime.now(timezone.utc)
            with SessionLocal() as db:
                events += simulator.tick_all(db, self.t)
        return events


def _sim(vehicle_id) -> TrackerSimulation:
    with SessionLocal() as db:
        return db.get(TrackerSimulation, vehicle_id)


def _tick_until(clock: Clock, vehicle_id: int, phase: str, limit: int = 30) -> TrackerSimulation:
    for _ in range(limit):
        clock.tick()
        if (sim := _sim(vehicle_id)).phase == phase:
            return sim
    raise AssertionError(f"não chegou em {phase}: {_sim(vehicle_id).phase}")


def test_simulated_tracker_drives_the_route_and_waits_for_the_driver(client, admin_headers, driver_headers, monkeypatch):
    me, vehicle = _joao(client, admin_headers, driver_headers)
    vid = vehicle["id"]
    clock = Clock(datetime.now(timezone.utc) - timedelta(minutes=20), monkeypatch)
    with SessionLocal() as db:  # as posições do simulador do seed (provedor "mock") ficam fora do teste
        db.execute(delete(Position).where(Position.vehicle_id == vid))
        db.commit()

    # Liga pelo motorista (o veículo é dele); outro motorista não mexe
    other = login(client, "222.222.222-22", "motorista123")
    assert client.put(f"/api/dev/simulations/{vid}", json={}, headers=other).status_code == 404
    r = client.put(f"/api/dev/simulations/{vid}", json={"speed_factor": 120, "dwell_min": 1}, headers=driver_headers)
    assert r.status_code == 200, r.text
    assert (r.json()["phase"], r.json()["speed_factor"], r.json()["cruise_kmh"], r.json()["auto_driver"]) == ("idle", 120, 40, False)
    assert [s["plate"] for s in client.get("/api/dev/simulations", headers=admin_headers).json()] == [vehicle["plate"]]
    assert client.get("/api/dev/simulations", headers=other).json() == []

    # Sem rota: o veículo aparece parado na base
    clock.tick()
    base = client.get("/api/company/base", headers=admin_headers).json()
    live = next(p for p in client.get("/api/tracking/live", headers=admin_headers).json() if p["vehicle_id"] == vid)
    assert (live["latitude"], live["longitude"], live["status"]) == (base["latitude"], base["longitude"], "at_base")

    # O motorista inicia a rota: o simulador pega o traçado planejado
    day = _assign(client, admin_headers, me["id"], ["Armazém do Bairro", "Empório Central", "Distribuidora Betim Norte"])
    run = client.post("/api/delivery-runs", json={"day": day}, headers=driver_headers).json()
    with SessionLocal() as db:
        db.get(DeliveryRun, run["id"]).started_at = clock.t + timedelta(seconds=5)
        db.commit()
    events = clock.tick()
    assert _sim(vid).phase == "driving"
    admin_id = client.get("/api/auth/me", headers=admin_headers).json()["id"]
    assert ([admin_id, me["id"]], {"type": "positions", "vehicle_id": vid}) in [(sorted(u), p) for u, p in events]

    # Anda até a 1ª parada e espera ali enquanto o motorista não registra a entrega
    first = run["stops"][0]
    sim = _tick_until(clock, vid, "at_stop")
    assert sim.stop_delivery_id == first["delivery"]["id"]
    assert haversine_km(sim.latitude, sim.longitude, first["latitude"], first["longitude"]) <= NEAR_STOP_KM
    clock.tick(3)
    assert (_sim(vid).phase, _sim(vid).latitude) == ("at_stop", sim.latitude)

    # A tela do motorista usa o rastreador simulado, mesmo com o celular mandando outra posição
    client.post(f"/api/delivery-runs/{run['id']}/points", headers=driver_headers, json={"points": [
        {"latitude": -19.5, "longitude": -44.5, "accuracy_m": 5, "recorded_at": datetime.now(timezone.utc).isoformat()},
    ]})
    current = client.get("/api/delivery-runs/current", headers=driver_headers).json()
    assert (current["simulated"], current["km_source"]) == (True, "tracker")
    assert current["current_position"] == [sim.latitude, sim.longitude]
    assert current["distance_km"] == pytest.approx(sim.progress_m / 1000, abs=0.05)
    status = client.get("/api/dev/simulations", headers=admin_headers).json()[0]
    assert (status["phase_text"], status["stop"]["customer_name"], status["stops_done"]) == (
        "Parado na entrega", first["delivery"]["customer_name"], 0)

    # Entregue com foto: depois do tempo de descarga ele segue para a próxima
    r = client.post(f"/api/deliveries/{first['delivery']['id']}/outcome", data={"outcome": "delivered"},
                    files={"photo": PHOTO}, headers=driver_headers)
    assert r.status_code == 200, r.text
    clock.tick()
    assert _sim(vid).phase in ("driving", "at_stop") and _sim(vid).stop_delivery_id != first["delivery"]["id"]

    # "Pular para a próxima parada" leva direto até ela e soma os km do caminho
    if _sim(vid).phase == "driving":
        r = client.post(f"/api/dev/simulations/{vid}/skip", headers=admin_headers)
        assert r.status_code == 200, r.text
    second = run["stops"][1]
    assert (_sim(vid).phase, _sim(vid).stop_delivery_id) == ("at_stop", second["delivery"]["id"])
    assert client.post(f"/api/dev/simulations/{vid}/skip", headers=admin_headers).status_code == 409

    # Motorista automático: entrega o resto com o comprovante gerado, volta para a base e encerra a rota
    client.put(f"/api/dev/simulations/{vid}", json={"auto_driver": True}, headers=admin_headers)
    _tick_until(clock, vid, "at_base")
    sim = _tick_until(clock, vid, "idle")
    finished = client.get(f"/api/delivery-runs/{run['id']}", headers=admin_headers).json()
    assert finished["status"] == "finished" and finished["km_source"] == "tracker"
    assert [s["delivery"]["status"] for s in finished["stops"]] == ["delivered"] * 3
    assert finished["distance_km"] == pytest.approx(sim.odometer_km, abs=0.05)
    assert finished["distance_km"] == pytest.approx(simulator.build_track(_run(run["id"])).length / 1000, abs=0.1)
    assert (sim.latitude, sim.longitude) == (base["latitude"], base["longitude"])
    auto = finished["stops"][2]["delivery"]
    assert "motorista automático" in auto["proof"]["note"]
    photo = client.get(f"/api/deliveries/{auto['id']}/proof/photo", headers=admin_headers)
    assert photo.headers["content-type"].startswith("image/svg") and b"Comprovante simulado" in photo.content

    # Caminho percorrido para o mapa do gestor
    trail = next(t for t in client.get("/api/tracking/trails", headers=admin_headers).json() if t["vehicle_id"] == vid)
    assert trail["driver_name"] == "João Pereira" and len(trail["points"]) > 5
    assert trail["distance_km"] == pytest.approx(finished["distance_km"], abs=0.1)
    assert [s["status"] for s in trail["run"]["stops"]] == ["delivered"] * 3
    assert [t["vehicle_id"] for t in client.get("/api/tracking/trails", headers=driver_headers).json()] == [vid]

    # O coletor dos rastreadores de verdade não grava posições do veículo simulado
    with SessionLocal() as db:
        real = select(func.count()).where(Position.vehicle_id == vid, Position.simulated.is_not(True))
        before = db.scalar(real)
        sync_company(db, db.scalars(select(Company)).one())
        assert db.scalar(real) == before

    # Recomeçar o teste: entregas de volta no caminhão, sem a rota de hoje e sem as posições simuladas
    r = client.post(f"/api/dev/simulations/{vid}/reset", headers=driver_headers)
    assert r.status_code == 200, r.text
    assert r.json()["runs"] == 1 and r.json()["deliveries"] == 3 and r.json()["positions"] > 5
    mine = client.get("/api/deliveries", params={"day": day}, headers=driver_headers).json()
    assert {d["status"] for d in mine} == {"assigned"} and all(d["proof"] is None for d in mine)
    assert client.get(f"/api/delivery-runs/{run['id']}", headers=admin_headers).status_code == 404

    assert client.delete(f"/api/dev/simulations/{vid}", headers=admin_headers).status_code == 204
    assert client.get("/api/dev/simulations", headers=admin_headers).json() == []


def _run(run_id) -> DeliveryRun:
    with SessionLocal() as db:
        return db.get(DeliveryRun, run_id)


def test_replanned_route_restarts_from_where_the_truck_is(client, admin_headers, driver_headers, monkeypatch):
    me, vehicle = _joao(client, admin_headers, driver_headers)
    vid = vehicle["id"]
    clock = Clock(datetime.now(timezone.utc) - timedelta(minutes=10), monkeypatch)
    with SessionLocal() as db:
        db.execute(delete(Position).where(Position.vehicle_id == vid, Position.recorded_at >= clock.t - timedelta(minutes=1)))
        db.commit()
    client.put(f"/api/dev/simulations/{vid}", json={"speed_factor": 5}, headers=admin_headers)
    day = _assign(client, admin_headers, me["id"], ["Empório Central"])
    run = client.post("/api/delivery-runs", json={"day": day}, headers=driver_headers).json()
    with SessionLocal() as db:
        db.get(DeliveryRun, run["id"]).started_at = clock.t
        db.commit()
    clock.tick(4)
    moved = _sim(vid)
    assert moved.phase == "driving" and moved.progress_m > 0

    # Entrega nova no caminhão: o motorista recalcula e o traçado novo sai de onde o veículo está
    _assign(client, admin_headers, me["id"], ["Armazém do Bairro"])
    replanned = client.post(f"/api/delivery-runs/{run['id']}/replan", headers=driver_headers).json()
    assert replanned["origin"] == [moved.latitude, moved.longitude]
    clock.tick()
    sim = _sim(vid)
    assert sim.progress_m == 0 and (sim.latitude, sim.longitude) == tuple(replanned["geometry"][0])


def test_dev_tools_can_be_turned_off(client, admin_headers, monkeypatch):
    monkeypatch.setattr(get_settings(), "dev_tools", False)
    r = client.get("/api/dev/simulations", headers=admin_headers)
    assert r.status_code == 404 and "DEV_TOOLS" in r.json()["detail"]
