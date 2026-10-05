"""Pausas na rota, comprovante de entrega com foto, histórico dos pneus, custo por km e ajuste de esquema."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, inspect, text

from app.db.upgrade import add_missing_columns
from app.models import RunStatus
from tests.conftest import login

PHOTO = ("canhoto.jpg", b"\xff\xd8\xff\xe0 foto de teste", "image/jpeg")


def _joao(client, admin_headers, driver_headers):
    me = client.get("/api/auth/me", headers=driver_headers).json()
    vehicle = next(v for v in client.get("/api/vehicles", headers=admin_headers).json() if v["current_driver_id"] == me["id"])
    return me, vehicle


def _assign(client, admin_headers, driver_id, customers):
    pending = {d["customer_name"]: d for d in client.get("/api/deliveries", headers=admin_headers).json()}
    ids = [pending[c]["id"] for c in customers]
    client.post("/api/deliveries/assign", json={"delivery_ids": ids, "driver_id": driver_id}, headers=admin_headers)
    return [pending[c] for c in customers]


def _start(client, headers, day):
    r = client.post("/api/delivery-runs", json={"day": day}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def test_pause_for_lunch_during_run(client, admin_headers, driver_headers):
    me, _ = _joao(client, admin_headers, driver_headers)
    delivery = _assign(client, admin_headers, me["id"], ["Drogaria Vida"])[0]
    run = _start(client, driver_headers, delivery["scheduled_for"])
    url = f"/api/delivery-runs/{run['id']}"

    paused = client.post(f"{url}/pauses", json={"kind": "meal"}, headers=driver_headers).json()
    assert paused["active_pause"]["kind"] == "meal" and paused["active_pause"]["ended_at"] is None
    assert client.post(f"{url}/pauses", json={"kind": "rest"}, headers=driver_headers).status_code == 409
    assert client.post(f"{url}/pauses", json={"kind": "nap"}, headers=driver_headers).status_code == 422
    # O gestor vê a pausa na tela de carregamento
    listed = client.get("/api/delivery-runs", params={"day": delivery["scheduled_for"]}, headers=admin_headers).json()
    assert listed[0]["active_pause"]["kind"] == "meal"

    resumed = client.post(f"{url}/pauses/end", headers=driver_headers).json()
    assert resumed["active_pause"] is None and resumed["pauses"][0]["ended_at"] is not None
    assert client.post(f"{url}/pauses/end", headers=driver_headers).status_code == 409

    client.post(f"{url}/pauses", json={"kind": "wait"}, headers=driver_headers)
    finished = client.post(f"{url}/finish", headers=driver_headers).json()
    assert finished["active_pause"] is None and all(p["ended_at"] for p in finished["pauses"])
    assert [p["kind"] for p in finished["pauses"]] == ["meal", "wait"]


def test_delivery_outcome_with_photo_reaches_manager_in_real_time(client, admin_headers, driver_headers):
    me, _ = _joao(client, admin_headers, driver_headers)
    first, second = _assign(client, admin_headers, me["id"], ["Drogaria Vida", "Armazém do Bairro"])
    run = _start(client, driver_headers, first["scheduled_for"])
    admin_token = admin_headers["Authorization"].removeprefix("Bearer ")

    with client.websocket_connect(f"/api/chat/ws?token={admin_token}") as ws:
        r = client.post(
            f"/api/deliveries/{first['id']}/outcome",
            data={"outcome": "delivered", "note": "Recebido pelo gerente", "latitude": "-19.47", "longitude": "-42.53"},
            files={"photo": PHOTO}, headers=driver_headers,
        )
        assert r.status_code == 200, r.text
        assert (r.json()["status"], r.json()["proof"]["outcome"], r.json()["proof"]["note"]) == ("delivered", "delivered", "Recebido pelo gerente")
        notice = ws.receive_json()
        assert notice == {"type": "delivery_outcome", "data": {
            "delivery_id": first["id"], "customer_name": "Drogaria Vida", "driver_name": "João Pereira",
            "outcome": "delivered", "reason": None,
        }}

    photo = client.get(f"/api/deliveries/{first['id']}/proof/photo", headers=admin_headers)
    assert photo.status_code == 200 and photo.content == PHOTO[1]
    other = login(client, "222.222.222-22", "motorista123")
    assert client.get(f"/api/deliveries/{first['id']}/proof/photo", headers=other).status_code == 404
    again = client.post(f"/api/deliveries/{first['id']}/outcome", data={"outcome": "delivered"}, files={"photo": PHOTO}, headers=driver_headers)
    assert again.status_code == 409

    # Não recebido: precisa do motivo e de uma imagem
    url = f"/api/deliveries/{second['id']}/outcome"
    assert client.post(url, data={"outcome": "failed"}, files={"photo": PHOTO}, headers=driver_headers).status_code == 422
    not_image = ("nota.pdf", b"%PDF", "application/pdf")
    assert client.post(url, data={"outcome": "failed", "reason": "absent"}, files={"photo": not_image}, headers=driver_headers).status_code == 422
    assert client.post(url, data={"outcome": "failed", "reason": "absent"}, files={"photo": PHOTO}, headers=other).status_code == 404
    failed = client.post(url, data={"outcome": "failed", "reason": "absent"}, files={"photo": PHOTO}, headers=driver_headers).json()
    assert (failed["status"], failed["proof"]["reason"]) == ("failed", "absent")

    # As duas paradas estão resolvidas: nada para recalcular
    current = client.get("/api/delivery-runs/current", headers=driver_headers).json()
    assert {s["delivery"]["customer_name"]: s["delivery"]["status"] for s in current["stops"]} == {
        "Drogaria Vida": "delivered", "Armazém do Bairro": "failed",
    }
    assert current["needs_replan"] is False

    # O gestor devolve a não entregue para a fila: a tentativa anterior continua registrada
    back = client.post("/api/deliveries/assign", json={"delivery_ids": [second["id"]], "driver_id": None}, headers=admin_headers).json()[0]
    assert (back["status"], back["proof"]["outcome"]) == ("pending", "failed")


def test_tire_rotation_retread_and_history(client, admin_headers, driver_headers):
    me, vehicle = _joao(client, admin_headers, driver_headers)
    url = f"/api/vehicles/{vehicle['id']}/tires"
    left = client.post(url, json={"position": "E1E", "measured_pct": 40, "life_km": 100_000, "cost": 1800}, headers=admin_headers).json()
    right = client.post(url, json={"position": "E1D", "measured_pct": 90, "cost": 1600}, headers=admin_headers).json()
    assert (left["cost_per_km"], left["wear_pct"], left["retreads"]) == (0.018, 60, 0)

    assert client.post(f"/api/tires/{left['id']}/rotate", json={"position": "E1D"}, headers=driver_headers).status_code == 403
    swapped = client.post(f"/api/tires/{left['id']}/rotate", json={"position": "E1D"}, headers=admin_headers).json()
    assert {(t["id"], t["position"]) for t in swapped} == {(left["id"], "E1D"), (right["id"], "E1E")}
    moved = client.post(f"/api/tires/{left['id']}/rotate", json={"position": "E2EE"}, headers=admin_headers).json()
    assert [(t["id"], t["position"]) for t in moved] == [(left["id"], "E2EE")]

    retread = client.post(f"/api/tires/{left['id']}/retread", json={"cost": 620}, headers=admin_headers).json()
    assert (retread["retreads"], retread["estimated_pct"], retread["wear_pct"]) == (1, 100, 0)

    events = client.get(f"/api/tires/{left['id']}/events", headers=driver_headers).json()
    assert [(e["kind"], e["detail"], e["cost"]) for e in events] == [
        ("retread", "1ª recapagem", 620), ("rotation", "E1D → E2EE", None), ("rotation", "E1E → E1D", None), ("mount", None, 1800),
    ]
    other = login(client, "222.222.222-22", "motorista123")
    assert client.get(f"/api/tires/{left['id']}/events", headers=other).status_code == 404


def test_cost_per_km_with_anp_fuel_price(client, admin_headers, driver_headers):
    me, vehicle = _joao(client, admin_headers, driver_headers)
    client.post(f"/api/vehicles/{vehicle['id']}/tires", json={"position": "E1E", "measured_pct": 100, "life_km": 80_000, "cost": 2000}, headers=admin_headers)
    client.post(f"/api/vehicles/{vehicle['id']}/tires", json={"position": "ESTEPE", "measured_pct": 100, "cost": 2000}, headers=admin_headers)

    prices = {p["fuel_type"]: p for p in client.get("/api/costs/fuel-prices", headers=admin_headers).json()}
    assert (prices["diesel"]["price_per_liter"], prices["diesel"]["source"]) == (6.94, "anp")
    assert prices["diesel"]["reference"] == "ANP · Contagem/MG · semana de 27/09 a 03/10/2026"
    assert client.get("/api/costs/fuel-prices", headers=driver_headers).status_code == 403

    # ~7,3 km de rota pelo GPS do celular (a 110 km/h)
    delivery = _assign(client, admin_headers, me["id"], ["Drogaria Vida"])[0]
    run = _start(client, driver_headers, delivery["scheduled_for"])
    t = datetime.now(timezone.utc)
    points = [
        {"latitude": -19.932, "longitude": -44.0539, "recorded_at": (t + timedelta(seconds=1)).isoformat()},
        {"latitude": -19.866, "longitude": -44.0539, "recorded_at": (t + timedelta(minutes=4)).isoformat()},
    ]
    client.post(f"/api/delivery-runs/{run['id']}/points", json={"points": points}, headers=driver_headers)
    client.post(f"/api/delivery-runs/{run['id']}/finish", headers=driver_headers)

    day = {"date_from": delivery["scheduled_for"], "date_to": delivery["scheduled_for"]}
    summary = client.get("/api/costs/summary", params=day, headers=admin_headers).json()
    row = next(v for v in summary["vehicles"] if v["vehicle_id"] == vehicle["id"])
    assert row["distance_km"] == pytest.approx(7.3, abs=0.1)
    assert (row["fuel_type"], row["km_per_liter"], row["drivers"], row["missing"]) == ("diesel", 5.5, ["João Pereira"], [])
    assert row["liters"] == round(row["distance_km"] / 5.5, 1)
    assert row["fuel_cost"] == round(row["liters"] * 6.94, 2)
    assert row["tire_cost"] == round(row["distance_km"] * 2000 / 80_000, 2)  # o estepe não entra
    assert row["cost_per_km"] == round(row["total_cost"] / row["distance_km"], 2)
    assert summary["total_cost"] == pytest.approx(row["total_cost"])

    assert client.get("/api/costs/summary", params={**day, "fuel_type": "gasolina"}, headers=admin_headers).json()["vehicles"] == []
    client.patch(f"/api/vehicles/{vehicle['id']}", json={"fuel_type": "gasolina"}, headers=admin_headers)
    client.put("/api/costs/fuel-prices/gasolina", json={"price_per_liter": 6.0}, headers=admin_headers)
    gas = client.get("/api/costs/summary", params={**day, "fuel_type": "gasolina"}, headers=admin_headers).json()
    assert gas["vehicles"][0]["fuel_cost"] == round(gas["vehicles"][0]["liters"] * 6.0, 2)
    manual = next(p for p in gas["prices"] if p["fuel_type"] == "gasolina")
    assert (manual["source"], manual["price_per_liter"]) == ("manual", 6.0)
    # O preço informado à mão só volta a ser o da ANP quando o gestor pede
    refreshed = {p["fuel_type"]: p for p in client.post("/api/costs/fuel-prices/anp", headers=admin_headers).json()}
    assert (refreshed["gasolina"]["source"], refreshed["gasolina"]["price_per_liter"]) == ("anp", 6.39)

    client.patch(f"/api/vehicles/{vehicle['id']}", json={"km_per_liter": None, "fuel_type": None}, headers=admin_headers)
    incomplete = client.get("/api/costs/summary", params=day, headers=admin_headers).json()
    assert next(v for v in incomplete["vehicles"] if v["vehicle_id"] == vehicle["id"])["missing"] == ["fuel_type", "km_per_liter", "price"]


def test_new_nullable_columns_are_added_to_old_tables(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'antigo.db'}")
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE vehicles (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, plate VARCHAR(8) NOT NULL, "
            "tracker_provider VARCHAR(7) NOT NULL, tracker_external_id VARCHAR(64) NOT NULL)"
        ))
        conn.execute(text("INSERT INTO vehicles VALUES (1, 1, 'ABC1D23', 'mock', 'X')"))
    add_missing_columns(engine)
    columns = {c["name"] for c in inspect(engine).get_columns("vehicles")}
    assert {"model", "capacity_kg", "current_driver_id", "fuel_type", "km_per_liter"} <= columns
    with engine.connect() as conn:
        assert conn.execute(text("SELECT plate, fuel_type FROM vehicles")).one() == ("ABC1D23", None)


def test_van_single_rear_axle_tires_measured_in_mm(client, admin_headers):
    van = client.post("/api/vehicles", json={
        "plate": "QUG0208", "model": "Fiat Ducato", "tracker_provider": "sascar", "tracker_external_id": "1591270",
        "axle_layout": "single",
    }, headers=admin_headers).json()
    url = f"/api/vehicles/{van['id']}/tires"
    base = {"brand": "Pirelli Chrono 225/75 R16C 118R", "tread_new_mm": 9.1, "cost": 1331}

    # Ducato não tem pneu interno
    r = client.post(url, json={**base, "position": "E2EI", "measured_pct": 90}, headers=admin_headers)
    assert r.status_code == 422 and "rodado traseiro simples" in r.json()["detail"]
    assert client.post(url, json={**base, "position": "E2E"}, headers=admin_headers).status_code == 422  # falta a medição

    front = client.post(url, json={**base, "position": "E1E", "measured_mm": 5.1, "life_km": 45_000}, headers=admin_headers).json()
    # (5,1 − 1,6) ÷ (9,1 − 1,6) = 46,7% de banda → 53,3% de desgaste: hora do rodízio
    assert (front["measured_pct"], front["estimated_mm"], front["wear_pct"]) == (46.7, 5.1, 53.3)
    assert (front["km_to_rotation"], front["km_to_replacement"]) == (0, round(0.217 * 45_000))
    rear = client.post(url, json={**base, "position": "E2E", "measured_mm": 7.2, "life_km": 70_000}, headers=admin_headers).json()
    assert rear["km_to_rotation"] == round((74.7 - 50) / 100 * 70_000)

    # Rodízio de tração dianteira: o dianteiro vai para trás no mesmo lado
    assert client.post(f"/api/tires/{front['id']}/rotate", json={"position": "E2DE"}, headers=admin_headers).status_code == 422
    swapped = client.post(f"/api/tires/{front['id']}/rotate", json={"position": "E2E"}, headers=admin_headers).json()
    assert {t["position"] for t in swapped} == {"E2E", "E1E"}

    measured = client.patch(f"/api/tires/{rear['id']}", json={"measured_mm": 4.6}, headers=admin_headers).json()
    assert measured["measured_pct"] == 40.0
    events = client.get(f"/api/tires/{rear['id']}/events", headers=admin_headers).json()
    assert (events[0]["kind"], events[0]["detail"]) == ("measure", "4.6 mm")

    # Não dá para trocar para rodado duplo com pneus em E2E/E2D
    r = client.patch(f"/api/vehicles/{van['id']}", json={"axle_layout": "dual"}, headers=admin_headers)
    assert r.status_code == 409 and "E2E" in r.json()["detail"]


def test_mock_data_creates_and_removes_only_test_records(client, admin_headers):
    from sqlalchemy import func, select

    from app import mock_data
    from app.db.session import SessionLocal
    from app.models import Company, Delivery, DeliveryRun, DriverPayment, Position, TrackerSimulation, User, Vehicle

    with SessionLocal() as db:
        company = db.scalars(select(Company)).one()
        before = {m: db.scalar(select(func.count()).select_from(m)) for m in (User, Vehicle, Delivery)}
        result = mock_data.create(db, company, days=4, seed=7)
        assert len(result["drivers"]) == 6 and result["runs"] >= 6 and result["deliveries_today"] >= 18
        runs = list(db.scalars(select(DeliveryRun).where(DeliveryRun.status == RunStatus.finished)))
        assert all(r.distance_km > 0 and r.region_name and r.load_kg for r in runs)
        assert db.scalar(select(func.count()).select_from(DriverPayment)) == len(runs)
        assert db.scalar(select(func.count()).select_from(TrackerSimulation)) == 6
        assert db.scalar(select(func.count()).where(Position.simulated.is_(True))) > len(runs) * 5
        # Rodar de novo recria (não duplica)
        mock_data.create(db, company, days=4, seed=8)
        assert db.scalar(select(func.count()).where(User.cpf.in_(mock_data.CPFS))) == 6
        assert db.scalar(select(func.count()).where(Vehicle.plate.in_(mock_data.PLATES))) == 6

    # Um motorista de teste entra com o CPF e a senha de teste e vê a carga de hoje
    headers = login(client, mock_data.CPFS[0], mock_data.PASSWORD)
    today = [d for d in client.get("/api/deliveries", headers=headers).json() if d["status"] == "assigned"]
    assert today and all(d["invoice_number"].startswith("TST-") for d in today)
    assert client.get("/api/delivery-runs/history", params={"date_from": "2020-01-01"}, headers=headers).json()

    with SessionLocal() as db:
        company = db.scalars(select(Company)).one()
        removed = mock_data.remove(db, company)
        assert removed["drivers"] == 6 and removed["vehicles"] == 6
        after = {m: db.scalar(select(func.count()).select_from(m)) for m in (User, Vehicle, Delivery)}
        assert after == before
