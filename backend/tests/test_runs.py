from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete

from app.db.session import SessionLocal
from app.models import DeliveryRun, Position
from app.services import geocoding, routing
from tests.conftest import login

VALID_CPF = "52998224725"


def _now():
    return datetime.now(timezone.utc)


def _joao(client, admin_headers, driver_headers):
    me = client.get("/api/auth/me", headers=driver_headers).json()
    vehicle = next(v for v in client.get("/api/vehicles", headers=admin_headers).json() if v["current_driver_id"] == me["id"])
    return me, vehicle


def _assign(client, admin_headers, driver_id, customers):
    pending = {d["customer_name"]: d for d in client.get("/api/deliveries", headers=admin_headers).json()}
    ids = [pending[c]["id"] for c in customers]
    r = client.post("/api/deliveries/assign", json={"delivery_ids": ids, "driver_id": driver_id}, headers=admin_headers)
    assert r.status_code == 200, r.text
    return pending[customers[0]]["scheduled_for"]


def _start(client, headers, day):
    return client.post("/api/delivery-runs", json={"day": day}, headers=headers)


def test_start_run_needs_vehicle_and_deliveries(client, admin_headers, driver_headers):
    day = client.get("/api/deliveries", headers=admin_headers).json()[0]["scheduled_for"]
    r = _start(client, driver_headers, day)
    assert r.status_code == 409 and "Não há entregas" in r.json()["detail"]
    assert _start(client, admin_headers, day).status_code == 403

    client.post("/api/drivers", json={"name": "Ana Lima", "cpf": VALID_CPF, "password": "segredo1"}, headers=admin_headers)
    r = _start(client, login(client, VALID_CPF, "segredo1"), day)
    assert r.status_code == 409 and "Meu veículo" in r.json()["detail"]


def test_start_run_orders_stops_from_base_and_counts_phone_km(client, admin_headers, driver_headers):
    me, _ = _joao(client, admin_headers, driver_headers)
    # O gestor marcou numa ordem ruim: Ipatinga, Contagem, Sete Lagoas
    day = _assign(client, admin_headers, me["id"], ["Drogaria Vida", "Armazém do Bairro", "Padaria Pão de Ouro"])

    r = _start(client, driver_headers, day)
    assert r.status_code == 201, r.text
    run = r.json()
    # Sem o OSRM (testes offline) a ordem sai pela parada mais próxima a partir da base em Contagem
    assert [s["delivery"]["customer_name"] for s in run["stops"]] == ["Armazém do Bairro", "Padaria Pão de Ouro", "Drogaria Vida"]
    assert (run["status"], run["optimized"], run["returns_to_base"]) == ("active", False, True)
    base = client.get("/api/company/base", headers=driver_headers).json()
    assert run["geometry"][0] == run["geometry"][-1] == [base["latitude"], base["longitude"]]
    assert run["planned_distance_km"] == pytest.approx(sum(s["leg_km"] for s in run["stops"]) + run["return_km"], abs=0.2)
    # A ordem calculada vira a ordem das paradas também para o gestor
    mine = sorted(client.get("/api/deliveries", headers=driver_headers).json(), key=lambda d: d["stop_order"])
    assert [d["id"] for d in mine] == [s["delivery"]["id"] for s in run["stops"]]
    assert _start(client, driver_headers, day).status_code == 409

    # GPS do celular: o primeiro trecho conta (~1,1 km), o tremor parado e o ponto impreciso não
    t = _now()
    points = [
        {"latitude": -19.5, "longitude": -44.5, "accuracy_m": 8, "recorded_at": (t - timedelta(minutes=30)).isoformat()},
        # obtido pouco antes de tocar em "Iniciar rota": vale como ponto de partida
        {"latitude": -19.9320, "longitude": -44.0539, "accuracy_m": 8, "recorded_at": (t - timedelta(seconds=30)).isoformat()},
        {"latitude": -19.9321, "longitude": -44.0540, "accuracy_m": 8, "recorded_at": (t + timedelta(seconds=20)).isoformat()},
        {"latitude": -19.9220, "longitude": -44.0539, "accuracy_m": 10, "recorded_at": (t + timedelta(seconds=90)).isoformat()},
        {"latitude": -19.5000, "longitude": -44.0000, "accuracy_m": 900, "recorded_at": (t + timedelta(seconds=120)).isoformat()},
    ]
    r = client.post(f"/api/delivery-runs/{run['id']}/points", json={"points": points}, headers=driver_headers)
    assert r.json() == {"accepted": 3}
    current = client.get("/api/delivery-runs/current", headers=driver_headers).json()
    assert current["km_source"] == "phone"
    assert current["distance_km"] == pytest.approx(1.11, abs=0.05)
    assert current["current_position"] == [-19.922, -44.0539]

    finished = client.post(f"/api/delivery-runs/{run['id']}/finish", headers=driver_headers).json()
    assert (finished["status"], finished["distance_km"]) == ("finished", current["distance_km"])
    assert client.get("/api/delivery-runs/current", headers=driver_headers).json() is None
    assert client.post(f"/api/delivery-runs/{run['id']}/finish", headers=driver_headers).status_code == 409
    listed = client.get("/api/delivery-runs", params={"day": day}, headers=admin_headers).json()
    assert [(r["driver_id"], r["status"]) for r in listed] == [(me["id"], "finished")]


def test_tracker_km_has_priority_over_phone(client, admin_headers, driver_headers):
    me, vehicle = _joao(client, admin_headers, driver_headers)
    day = _assign(client, admin_headers, me["id"], ["Drogaria Vida"])
    run = _start(client, driver_headers, day).json()

    # A rota começou há 10 minutos e o rastreador mandou 3 posições desde então
    t = _now() - timedelta(minutes=10)
    with SessionLocal() as db:
        db.get(DeliveryRun, run["id"]).started_at = t
        db.execute(delete(Position).where(Position.vehicle_id == vehicle["id"], Position.recorded_at >= t))  # as do seed
        db.add_all(
            Position(vehicle_id=vehicle["id"], driver_id=me["id"], recorded_at=t + timedelta(minutes=m), latitude=lat,
                     longitude=-44.0539, speed_kmh=50, ignition=True)
            for m, lat in [(1, -19.932), (2, -19.923), (3, -19.914)]
        )
        db.commit()
    phone = [{"latitude": -19.9, "longitude": -44.0, "recorded_at": (t + timedelta(minutes=4)).isoformat()}]
    client.post(f"/api/delivery-runs/{run['id']}/points", json={"points": phone}, headers=driver_headers)

    current = client.get(f"/api/delivery-runs/{run['id']}", headers=admin_headers).json()
    assert current["km_source"] == "tracker"
    assert current["distance_km"] == pytest.approx(2.0, abs=0.05)
    assert len(current["trail"]) == 3


def test_tire_wear_follows_route_km(client, admin_headers, driver_headers):
    me, vehicle = _joao(client, admin_headers, driver_headers)
    url = f"/api/vehicles/{vehicle['id']}/tires"
    front = {"position": "E1E", "brand": "Michelin X Multi", "identification": "F-102", "measured_pct": 90, "life_km": 50_000}
    r = client.post(url, json=front, headers=admin_headers)
    assert r.status_code == 201, r.text
    tire = r.json()
    assert (tire["estimated_pct"], tire["remaining_km"], tire["wear_per_1000km_pct"]) == (90, 45_000, 2.0)
    assert client.post(url, json=front, headers=admin_headers).status_code == 409
    assert client.post(url, json={**front, "position": "ESTEPE"}, headers=driver_headers).status_code == 403
    client.post(url, json={"position": "ESTEPE", "measured_pct": 100}, headers=admin_headers)

    day = _assign(client, admin_headers, me["id"], ["Drogaria Vida"])
    run = _start(client, driver_headers, day).json()
    t = _now()
    ten_km = [  # ~10 km para o norte em 10 minutos
        {"latitude": -19.932, "longitude": -44.0539, "recorded_at": (t + timedelta(seconds=1)).isoformat()},
        {"latitude": -19.842, "longitude": -44.0539, "recorded_at": (t + timedelta(minutes=4)).isoformat()},
    ]
    client.post(f"/api/delivery-runs/{run['id']}/points", json={"points": ten_km}, headers=driver_headers)

    tires = {t["position"]: t for t in client.get("/api/tires", headers=driver_headers).json()}
    assert tires["E1E"]["km_since_measure"] == pytest.approx(10.0, abs=0.1)
    assert tires["E1E"]["estimated_pct"] == pytest.approx(89.98, abs=0.01)
    assert (tires["ESTEPE"]["in_use"], tires["ESTEPE"]["estimated_pct"]) == (False, 100)
    current = client.get("/api/delivery-runs/current", headers=driver_headers).json()
    assert current["tire_wear_pct"] == pytest.approx(0.02, abs=0.001)
    assert current["worst_tire"]["position"] == "E1E"

    # Depois da rota, o gestor mede de novo: a estimativa recomeça da medição
    client.post(f"/api/delivery-runs/{run['id']}/finish", headers=driver_headers)
    r = client.patch(f"/api/tires/{tire['id']}", json={"measured_pct": 70, "brand": ""}, headers=admin_headers)
    assert (r.json()["estimated_pct"], r.json()["km_since_measure"], r.json()["brand"]) == (70, 0, None)
    assert client.patch(f"/api/tires/{tire['id']}", json={"position": "ESTEPE"}, headers=admin_headers).status_code == 422

    other = next(v for v in client.get("/api/vehicles", headers=admin_headers).json() if v["id"] != vehicle["id"])
    client.post(f"/api/vehicles/{other['id']}/tires", json={"position": "E1D", "measured_pct": 80}, headers=admin_headers)
    assert {t["vehicle_id"] for t in client.get("/api/tires", headers=driver_headers).json()} == {vehicle["id"]}
    assert len(client.get("/api/tires", headers=admin_headers).json()) == 3
    assert client.delete(f"/api/tires/{tire['id']}", headers=driver_headers).status_code == 403
    assert client.delete(f"/api/tires/{tire['id']}", headers=admin_headers).status_code == 204


def test_new_delivery_during_run_asks_to_replan(client, admin_headers, driver_headers):
    me, _ = _joao(client, admin_headers, driver_headers)
    day = _assign(client, admin_headers, me["id"], ["Drogaria Vida", "Armazém do Bairro"])
    run = _start(client, driver_headers, day).json()
    assert run["needs_replan"] is False

    _assign(client, admin_headers, me["id"], ["Distribuidora Betim Norte"])
    current = client.get("/api/delivery-runs/current", headers=driver_headers).json()
    assert current["needs_replan"] is True
    assert [(s["delivery"]["customer_name"], s["planned"]) for s in current["stops"]][-1] == ("Distribuidora Betim Norte", False)

    replanned = client.post(f"/api/delivery-runs/{run['id']}/replan", headers=driver_headers).json()
    assert replanned["needs_replan"] is False
    assert [s["delivery"]["customer_name"] for s in replanned["stops"]] == ["Armazém do Bairro", "Distribuidora Betim Norte", "Drogaria Vida"]

    other = login(client, "222.222.222-22", "motorista123")
    assert client.get(f"/api/delivery-runs/{run['id']}", headers=other).status_code == 404
    assert client.post(f"/api/delivery-runs/{run['id']}/replan", headers=other).status_code == 404


def test_osrm_trip_response_is_read_in_visit_order(monkeypatch):
    def fake_osrm(path, params):
        assert params | {} == params and params["source"] == "first" and params["destination"] == "last"
        assert path.count(";") == 4  # base, 3 paradas, base
        return {
            "code": "Ok",
            # entrada 1 é visitada em 3º, entrada 2 em 1º, entrada 3 em 2º
            "waypoints": [{"waypoint_index": i} for i in (0, 3, 1, 2, 4)],
            "trips": [{
                "legs": [{"distance": d * 1000, "duration": 600} for d in (5, 7, 11, 13)],
                "geometry": {"coordinates": [[-44.05, -19.93], [-44.0, -19.9]]},
            }],
        }

    monkeypatch.setattr(routing, "_osrm_request", fake_osrm)
    base = (-19.93, -44.05)
    plan = routing.plan_route(base, [(-19.5, -42.5), (-19.9, -44.0), (-19.5, -44.2)], base)
    assert plan.order == [1, 2, 0]
    assert (plan.legs_km, plan.return_km, plan.distance_km, plan.duration_min) == ([5, 7, 11], 13, 36, 40)
    assert plan.geometry == [[-19.93, -44.05], [-19.9, -44.0]] and plan.optimized


def test_locate_falls_back_to_city_and_caches(offline_maps):
    def city_only(q, limit=5, near=None):
        offline_maps.append(q)
        return [{"lat": "-19.47", "lon": "-42.53"}] if q == "Ipatinga, Brasil" else []

    with SessionLocal() as db:
        from app.db.base import Base
        from app.db.session import engine

        Base.metadata.create_all(bind=engine)
        original = geocoding.search
        geocoding.search = city_only
        try:
            loc = geocoding.locate(db, "Rua Inexistente, 10", "Ipatinga")
            assert (loc.latitude, loc.longitude, loc.precision) == (-19.47, -42.53, "city")
            assert offline_maps == ["Rua Inexistente, 10, Ipatinga, Brasil", "Rua Inexistente, Ipatinga, Brasil", "Ipatinga, Brasil"]
            assert geocoding.locate(db, "rua inexistente, 10", "IPATINGA") == loc  # do cache, sem nova busca
            assert len(offline_maps) == 3
        finally:
            geocoding.search = original


def test_two_routes_in_the_same_day_stay_separate(client, admin_headers, driver_headers):
    photo = ("canhoto.jpg", b"\xff\xd8\xff\xe0 foto", "image/jpeg")
    me, _ = _joao(client, admin_headers, driver_headers)

    # Rota 1: Contagem e BH; entrega a de Contagem, chega uma nova no meio (Betim) e recalcula
    day = _assign(client, admin_headers, me["id"], ["Armazém do Bairro", "Empório Central"])
    first = _start(client, driver_headers, day).json()
    stops = {s["delivery"]["customer_name"]: s["delivery"]["id"] for s in first["stops"]}
    client.post(f"/api/deliveries/{stops['Armazém do Bairro']}/outcome", data={"outcome": "delivered"}, files={"photo": photo}, headers=driver_headers)
    _assign(client, admin_headers, me["id"], ["Distribuidora Betim Norte"])
    replanned = client.post(f"/api/delivery-runs/{first['id']}/replan", headers=driver_headers).json()
    # A entrega já feita continua na rota (antes sumia ao recalcular)
    assert {s["delivery"]["customer_name"] for s in replanned["stops"]} == {"Armazém do Bairro", "Empório Central", "Distribuidora Betim Norte"}
    for name in ("Empório Central", "Distribuidora Betim Norte"):
        client.post(f"/api/deliveries/{stops.get(name) or next(s['delivery']['id'] for s in replanned['stops'] if s['delivery']['customer_name'] == name)}/outcome",
                    data={"outcome": "delivered"}, files={"photo": photo}, headers=driver_headers)
    client.post(f"/api/delivery-runs/{first['id']}/finish", headers=driver_headers)

    # Rota 2 no mesmo dia: a nova carga do caminhão, sem nada da rota 1
    _assign(client, admin_headers, me["id"], ["Padaria Pão de Ouro"])
    second = _start(client, driver_headers, day).json()
    assert [s["delivery"]["customer_name"] for s in second["stops"]] == ["Padaria Pão de Ouro"]
    assert second["load_kg"] == 260
    # E a rota 1, vista depois, não ganha a entrega da rota 2
    again = client.get(f"/api/delivery-runs/{first['id']}", headers=driver_headers).json()
    assert {s["delivery"]["customer_name"] for s in again["stops"]} == {"Armazém do Bairro", "Empório Central", "Distribuidora Betim Norte"}

    history = client.get("/api/delivery-runs/history", headers=driver_headers).json()
    assert [(h["id"], h["day_index"], h["status"]) for h in history] == [(second["id"], 2, "active"), (first["id"], 1, "finished")]
    assert [d["customer_name"] for d in history[0]["stops"]] == ["Padaria Pão de Ouro"]
    assert {d["status"] for d in history[1]["stops"]} == {"delivered"} and all(d["proof"] for d in history[1]["stops"])
    assert history[1]["payment"]["amount"] == history[1]["region_price"] and history[1]["payment"]["status"] == "pending"
    assert history[1]["plate"] and history[1]["driver_name"] == "João Pereira"
    other = login(client, "222.222.222-22", "motorista123")
    assert client.get("/api/delivery-runs/history", headers=other).json() == []
    assert len(client.get("/api/delivery-runs/history", params={"driver_id": me["id"]}, headers=admin_headers).json()) == 2
