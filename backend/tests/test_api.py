from tests.conftest import login


def test_login_wrong_password(client):
    r = client.post("/api/auth/login", json={"login": "gestor@frotagest.dev", "password": "errada"})
    assert r.status_code == 401


def test_me_returns_role(client, admin_headers, driver_headers):
    assert client.get("/api/auth/me", headers=admin_headers).json()["role"] == "admin"
    assert client.get("/api/auth/me", headers=driver_headers).json()["role"] == "driver"


def test_driver_cannot_list_drivers(client, driver_headers):
    assert client.get("/api/drivers", headers=driver_headers).status_code == 403


def test_live_positions(client, admin_headers):
    rows = client.get("/api/tracking/live", headers=admin_headers).json()
    assert len(rows) == 3
    assert {r["status"] for r in rows} <= {"moving", "stopped", "speeding", "offline", "at_base"}


def test_routes_driver_sees_only_own(client, admin_headers, driver_headers):
    all_routes = client.get("/api/tracking/routes", headers=admin_headers).json()
    own = client.get("/api/tracking/routes", headers=driver_headers).json()
    assert len(all_routes) >= len(own) >= 1
    assert {r["driver_name"] for r in own} == {"João Pereira"}
    assert all(r["distance_km"] > 0 for r in own)


def test_chat_flow(client, admin_headers, driver_headers):
    convs = client.get("/api/chat/conversations", headers=driver_headers).json()
    group = next(c for c in convs if c["kind"] == "group")
    r = client.post(f"/api/chat/conversations/{group['id']}/messages", json={"body": "Trânsito na BR-040"}, headers=driver_headers)
    assert r.status_code == 201
    msgs = client.get(f"/api/chat/conversations/{group['id']}/messages", headers=admin_headers).json()
    assert msgs[-1]["body"] == "Trânsito na BR-040"
    assert msgs[-1]["sender_name"] == "João Pereira"


def test_create_vehicle_duplicate_plate(client, admin_headers):
    body = {"plate": "ABC1D23", "tracker_provider": "sascar", "tracker_external_id": "123"}
    assert client.post("/api/vehicles", json=body, headers=admin_headers).status_code == 201
    assert client.post("/api/vehicles", json=body, headers=admin_headers).status_code == 409


VALID_CPF = "52998224725"


def test_driver_without_vehicle_registers_own(client, admin_headers):
    body = {"name": "Ana Lima", "cpf": VALID_CPF, "password": "segredo1"}
    driver = client.post("/api/drivers", json=body, headers=admin_headers).json()
    ana = login(client, VALID_CPF, "segredo1")
    assert client.get("/api/vehicles", headers=ana).json() == []

    vehicle = {"plate": "rxy4b21", "tracker_provider": "mock", "tracker_external_id": "X"}
    r = client.post("/api/vehicles", json=vehicle, headers=ana)
    assert r.status_code == 409 and "base" in r.json()["detail"]  # placa já é de outro caminhão

    vehicle = {
        "plate": "abc-1d23", "model": " Mercedes Accelo ", "capacity_kg": 4500,
        "tracker_provider": "sascar", "tracker_external_id": "SAS-77", "current_driver_id": 1,
    }
    r = client.post("/api/vehicles", json=vehicle, headers=ana)
    assert r.status_code == 201, r.text
    created = r.json()
    assert (created["plate"], created["model"], created["current_driver_id"]) == ("ABC1D23", "Mercedes Accelo", driver["id"])
    assert client.get("/api/vehicles", headers=ana).json() == [created]
    assert client.post("/api/vehicles", json={**vehicle, "plate": "DEF2E34"}, headers=ana).status_code == 409


def test_driver_fills_only_blank_vehicle_fields(client, admin_headers, driver_headers):
    own, other = None, None
    joao_id = client.get("/api/auth/me", headers=driver_headers).json()["id"]
    for v in client.get("/api/vehicles", headers=admin_headers).json():
        if v["current_driver_id"] == joao_id:
            own = v
        else:
            other = v
    url = f"/api/vehicles/{own['id']}"

    r = client.patch(url, json={"model": None, "capacity_kg": None}, headers=admin_headers)
    assert r.status_code == 200 and (r.json()["model"], r.json()["capacity_kg"]) == (None, None)
    assert client.patch(url, json={"plate": None}, headers=admin_headers).status_code == 422

    r = client.patch(url, json={"capacity_kg": 7000, "model": "VW Delivery 9.170", "plate": own["plate"]}, headers=driver_headers)
    assert r.status_code == 200, r.text
    assert (r.json()["capacity_kg"], r.json()["model"]) == (7000, "VW Delivery 9.170")
    assert client.patch(url, json={"capacity_kg": 8000}, headers=driver_headers).status_code == 403
    assert client.patch(url, json={"plate": "ZZZ9Z99"}, headers=driver_headers).status_code == 403
    assert client.patch(f"/api/vehicles/{other['id']}", json={"capacity_kg": 1}, headers=driver_headers).status_code == 404


def test_create_driver_with_new_vehicle(client, admin_headers):
    body = {
        "name": "Ana Lima", "cpf": VALID_CPF, "phone": "(31) 98888-7777", "password": "segredo1",
        "cnh_number": "12345678900", "cnh_category": "E", "cnh_expires_at": "2030-05-01",
        "new_vehicle": {
            "plate": "abc-1d23", "model": "VW Constellation", "capacity_kg": 14000,
            "tracker_provider": "mock", "tracker_external_id": "MOCK-ABC1D23",
        },
    }
    r = client.post("/api/drivers", json=body, headers=admin_headers)
    assert r.status_code == 201, r.text
    driver = r.json()
    assert (driver["cnh_category"], driver["cnh_expires_at"]) == ("E", "2030-05-01")
    vehicle = next(v for v in client.get("/api/vehicles", headers=admin_headers).json() if v["plate"] == "ABC1D23")
    assert (vehicle["current_driver_id"], vehicle["capacity_kg"]) == (driver["id"], 14000)
    login(client, "529.982.247-25", "segredo1")


def test_create_driver_takes_existing_vehicle(client, admin_headers):
    vehicle = client.get("/api/vehicles", headers=admin_headers).json()[0]
    body = {"name": "Ana Lima", "cpf": VALID_CPF, "password": "segredo1", "vehicle_id": vehicle["id"]}
    driver = client.post("/api/drivers", json=body, headers=admin_headers).json()
    moved = next(v for v in client.get("/api/vehicles", headers=admin_headers).json() if v["id"] == vehicle["id"])
    assert moved["current_driver_id"] == driver["id"]


def test_create_driver_rejects_bad_data(client, admin_headers, driver_headers):
    body = {"name": "Ana Lima", "cpf": VALID_CPF, "password": "segredo1"}
    assert client.post("/api/drivers", json=body, headers=driver_headers).status_code == 403
    assert client.post("/api/drivers", json={**body, "cpf": "12345678900"}, headers=admin_headers).status_code == 422
    bad_plate = {"plate": "AB12345", "tracker_provider": "mock", "tracker_external_id": "X"}
    assert client.post("/api/drivers", json={**body, "new_vehicle": bad_plate}, headers=admin_headers).status_code == 422
    assert client.post("/api/drivers", json=body, headers=admin_headers).status_code == 201
    assert client.post("/api/drivers", json=body, headers=admin_headers).status_code == 409


def test_dispatch_assign_and_return(client, admin_headers, driver_headers):
    pending = client.get("/api/deliveries", headers=admin_headers).json()
    assert len(pending) == 9 and {d["status"] for d in pending} == {"pending"}
    joao = next(d for d in client.get("/api/drivers", headers=admin_headers).json() if d["name"] == "João Pereira")

    ids = [pending[2]["id"], pending[0]["id"]]
    r = client.post("/api/deliveries/assign", json={"delivery_ids": ids, "driver_id": joao["id"]}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert [(d["id"], d["stop_order"], d["status"]) for d in r.json()] == [(ids[0], 1, "assigned"), (ids[1], 2, "assigned")]

    more = client.post("/api/deliveries/assign", json={"delivery_ids": [pending[5]["id"]], "driver_id": joao["id"]}, headers=admin_headers)
    assert more.json()[0]["stop_order"] == 3
    assert {d["id"] for d in client.get("/api/deliveries", headers=driver_headers).json()} == {*ids, pending[5]["id"]}

    back = client.post("/api/deliveries/assign", json={"delivery_ids": [ids[0]], "driver_id": None}, headers=admin_headers).json()[0]
    assert (back["status"], back["driver_id"], back["stop_order"]) == ("pending", None, None)


def test_dispatch_create_delete_and_permissions(client, admin_headers, driver_headers):
    body = {"scheduled_for": "2031-03-10", "customer_name": "Padaria Teste", "address": "Rua A, 10", "city": "Betim", "weight_kg": 120}
    assert client.post("/api/deliveries", json=body, headers=driver_headers).status_code == 403
    created = client.post("/api/deliveries", json=body, headers=admin_headers).json()
    assert client.get("/api/deliveries", params={"day": "2031-03-10"}, headers=admin_headers).json() == [created]

    joao_id = client.get("/api/auth/me", headers=driver_headers).json()["id"]
    client.post("/api/deliveries/assign", json={"delivery_ids": [created["id"]], "driver_id": joao_id}, headers=admin_headers)
    assert client.delete(f"/api/deliveries/{created['id']}", headers=admin_headers).status_code == 409
    client.post("/api/deliveries/assign", json={"delivery_ids": [created["id"]], "driver_id": None}, headers=admin_headers)
    assert client.delete(f"/api/deliveries/{created['id']}", headers=admin_headers).status_code == 204


def _conversations(client, headers):
    return client.get("/api/chat/conversations", headers=headers).json()


def test_chat_contacts_by_role(client, admin_headers, driver_headers):
    admin_contacts = client.get("/api/chat/contacts", headers=admin_headers).json()
    assert {"João Pereira", "Carla Mendes", "Rafael Souza"} <= {c["name"] for c in admin_contacts}
    driver_contacts = client.get("/api/chat/contacts", headers=driver_headers).json()
    assert driver_contacts and {c["role"] for c in driver_contacts} == {"admin"}


def test_direct_conversation_is_reused_and_driver_limits(client, admin_headers, driver_headers):
    carla = next(c for c in client.get("/api/chat/contacts", headers=admin_headers).json() if c["name"] == "Carla Mendes")
    body = {"kind": "direct", "member_ids": [carla["id"]]}
    first = client.post("/api/chat/conversations", json=body, headers=admin_headers)
    again = client.post("/api/chat/conversations", json=body, headers=admin_headers)
    assert (first.status_code, again.status_code) == (201, 200)
    assert first.json()["id"] == again.json()["id"]
    assert first.json()["name"] == "Carla Mendes"

    assert client.post("/api/chat/conversations", json=body, headers=driver_headers).status_code == 403
    group = {"kind": "group", "name": "Motoristas", "member_ids": [carla["id"]]}
    assert client.post("/api/chat/conversations", json=group, headers=driver_headers).status_code == 403


def test_unread_count_and_mark_read(client, admin_headers, driver_headers):
    group = next(c for c in _conversations(client, driver_headers) if c["kind"] == "group")
    client.post(f"/api/chat/conversations/{group['id']}/messages", json={"body": "Saindo do CD"}, headers=driver_headers)

    seen_by_admin = next(c for c in _conversations(client, admin_headers) if c["id"] == group["id"])
    assert seen_by_admin["unread_count"] >= 1
    assert seen_by_admin["last_message_sender_name"] == "João Pereira"
    assert client.post(f"/api/chat/conversations/{group['id']}/read", headers=admin_headers).status_code == 204
    assert next(c for c in _conversations(client, admin_headers) if c["id"] == group["id"])["unread_count"] == 0

    msgs = client.get(f"/api/chat/conversations/{group['id']}/messages", headers=admin_headers).json()
    assert msgs[-1]["created_at"].endswith(("Z", "+00:00"))


def test_admin_edits_group_members(client, admin_headers, driver_headers):
    ids = {c["name"]: c["id"] for c in client.get("/api/chat/contacts", headers=admin_headers).json()}
    body = {"kind": "group", "name": "Rota Vale do Aço", "member_ids": [ids["João Pereira"], ids["Carla Mendes"]]}
    created = client.post("/api/chat/conversations", json=body, headers=admin_headers)
    assert created.status_code == 201
    gid = created.json()["id"]
    assert any(c["id"] == gid for c in _conversations(client, driver_headers))

    update = {"name": "Vale do Aço", "member_ids": [ids["Carla Mendes"]]}
    assert client.put(f"/api/chat/conversations/{gid}", json=update, headers=driver_headers).status_code == 403
    r = client.put(f"/api/chat/conversations/{gid}", json=update, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Vale do Aço"
    assert {m["name"] for m in r.json()["members"]} == {"Marina Costa", "Carla Mendes"}
    assert not any(c["id"] == gid for c in _conversations(client, driver_headers))


def test_company_base(client, admin_headers, driver_headers):
    base = client.get("/api/company/base", headers=driver_headers).json()
    assert base["name"] == "CD Contagem" and base["radius_m"] == 500

    body = {"name": "CD Betim", "address": "Betim - MG", "latitude": -19.97, "longitude": -44.2, "radius_m": 400}
    assert client.put("/api/company/base", json=body, headers=driver_headers).status_code == 403
    assert client.put("/api/company/base", json={**body, "radius_m": 10}, headers=admin_headers).status_code == 422
    r = client.put("/api/company/base", json=body, headers=admin_headers)
    assert r.status_code == 200 and r.json()["name"] == "CD Betim"
    assert client.get("/api/company/base", headers=admin_headers).json() == r.json()


def test_route_detail_splits_trips_from_base(client, admin_headers):
    base = client.get("/api/company/base", headers=admin_headers).json()
    routes = client.get("/api/tracking/routes", headers=admin_headers).json()
    trips_from_base = 0
    for route in routes:
        detail = client.get(
            f"/api/tracking/routes/{route['vehicle_id']}/detail", params={"day": route["day"]}, headers=admin_headers
        ).json()
        assert detail["points"]
        for trip in detail["trips"]:
            assert 0 <= trip["start_index"] < trip["end_index"] < len(detail["points"])
            if trip["left_base"]:
                start = detail["points"][trip["start_index"]]
                assert abs(start["latitude"] - base["latitude"]) < 0.01 and abs(start["longitude"] - base["longitude"]) < 0.01
                trips_from_base += 1
    # O simulador sai do CD e volta a cada ~100 min; em 2 h de dados algum caminhão sai da base
    assert trips_from_base >= 1


def test_summary_counts_todays_deliveries(client, admin_headers):
    summary = client.get("/api/tracking/summary", headers=admin_headers).json()
    assert (summary["deliveries_today"], summary["deliveries_pending"]) == (9, 9)

    pending = client.get("/api/deliveries", headers=admin_headers).json()
    driver_id = client.get("/api/drivers", headers=admin_headers).json()[0]["id"]
    body = {"delivery_ids": [d["id"] for d in pending[:2]], "driver_id": driver_id}
    client.post("/api/deliveries/assign", json=body, headers=admin_headers)
    summary = client.get("/api/tracking/summary", headers=admin_headers).json()
    assert (summary["deliveries_today"], summary["deliveries_pending"]) == (9, 7)


def test_assign_notifies_drivers_in_real_time(client, admin_headers, driver_headers):
    token = driver_headers["Authorization"].removeprefix("Bearer ")
    drivers = {d["name"]: d["id"] for d in client.get("/api/drivers", headers=admin_headers).json()}
    pending = client.get("/api/deliveries", headers=admin_headers).json()
    ids = [pending[0]["id"], pending[1]["id"]]

    with client.websocket_connect(f"/api/chat/ws?token={token}") as ws:
        body = {"delivery_ids": ids, "driver_id": drivers["João Pereira"]}
        client.post("/api/deliveries/assign", json=body, headers=admin_headers)
        notice = ws.receive_json()
        assert notice["type"] == "deliveries_assigned"
        assert notice["data"] == {
            "day": pending[0]["scheduled_for"], "count": 2,
            "weight_kg": pending[0]["weight_kg"] + pending[1]["weight_kg"], "assigned_by": "Marina Costa",
        }

        client.post("/api/deliveries/assign", json={"delivery_ids": ids[:1], "driver_id": drivers["Carla Mendes"]}, headers=admin_headers)
        assert ws.receive_json() == {"type": "deliveries_changed"}


def test_driver_lists_upcoming_deliveries(client, admin_headers, driver_headers):
    joao_id = client.get("/api/auth/me", headers=driver_headers).json()["id"]
    later = {"scheduled_for": "2031-03-12", "customer_name": "Padaria Teste", "address": "Rua A, 10", "city": "Betim", "weight_kg": 120}
    created = client.post("/api/deliveries", json=later, headers=admin_headers).json()
    client.post("/api/deliveries/assign", json={"delivery_ids": [created["id"]], "driver_id": joao_id}, headers=admin_headers)

    period = {"date_from": "2031-03-10", "date_to": "2031-03-20"}
    rows = client.get("/api/deliveries", params=period, headers=driver_headers).json()
    assert [(d["id"], d["stop_order"]) for d in rows] == [(created["id"], 1)]
    assert client.get("/api/deliveries", params={"date_from": "2031-03-10"}, headers=driver_headers).status_code == 422
    assert client.get("/api/deliveries", params={**period, "date_to": "2031-12-31"}, headers=driver_headers).status_code == 422


def test_admin_edits_vehicle_and_moves_driver(client, admin_headers, driver_headers):
    vehicles = {v["plate"]: v for v in client.get("/api/vehicles", headers=admin_headers).json()}
    joao = client.get("/api/auth/me", headers=driver_headers).json()
    carla = next(d for d in client.get("/api/drivers", headers=admin_headers).json() if d["name"] == "Carla Mendes")
    own, carlas = vehicles["RXY4B21"], vehicles["QTE9A88"]

    # Corrige a placa e os dados do rastreador
    r = client.patch(f"/api/vehicles/{own['id']}", json={"plate": "rxy-4b22", "model": "VW Delivery 9.170", "tracker_provider": "sascar", "tracker_external_id": " 1591270 "}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert (r.json()["plate"], r.json()["tracker_provider"], r.json()["tracker_external_id"]) == ("RXY4B22", "sascar", "1591270")
    assert client.patch(f"/api/vehicles/{own['id']}", json={"plate": "QTE9A88"}, headers=admin_headers).status_code == 409
    assert client.patch(f"/api/vehicles/{own['id']}", json={"plate": "XX"}, headers=admin_headers).status_code == 422

    # O veículo do João vai para a Carla: o dela fica livre, e o João fica sem veículo
    r = client.patch(f"/api/vehicles/{own['id']}", json={"current_driver_id": carla["id"]}, headers=admin_headers)
    assert r.json()["current_driver_id"] == carla["id"]
    now = {v["id"]: v for v in client.get("/api/vehicles", headers=admin_headers).json()}
    assert now[carlas["id"]]["current_driver_id"] is None
    assert client.get("/api/vehicles", headers=driver_headers).json() == []
    assert client.patch(f"/api/vehicles/{own['id']}", json={"current_driver_id": 9999}, headers=admin_headers).status_code == 404

    # Sem motorista, e o motorista não troca o motorista do próprio veículo
    client.patch(f"/api/vehicles/{carlas['id']}", json={"current_driver_id": joao["id"]}, headers=admin_headers)
    assert client.patch(f"/api/vehicles/{carlas['id']}", json={"current_driver_id": None}, headers=driver_headers).status_code == 403
    r = client.patch(f"/api/vehicles/{carlas['id']}", json={"current_driver_id": None}, headers=admin_headers)
    assert r.json()["current_driver_id"] is None

    # Veículo novo já com o João: o anterior dele (se houver) fica livre
    client.patch(f"/api/vehicles/{carlas['id']}", json={"current_driver_id": joao["id"]}, headers=admin_headers)
    body = {"plate": "QUG0208", "model": "Fiat Ducato", "tracker_provider": "sascar", "tracker_external_id": "1591270", "current_driver_id": joao["id"]}
    created = client.post("/api/vehicles", json=body, headers=admin_headers).json()
    assert created["current_driver_id"] == joao["id"]
    assert [v["plate"] for v in client.get("/api/vehicles", headers=driver_headers).json()] == ["QUG0208"]
    assert client.post("/api/vehicles", json={**body, "plate": "ABC1D23", "current_driver_id": 9999}, headers=admin_headers).status_code == 404


def test_delete_vehicle_with_its_history(client, admin_headers, driver_headers):
    from datetime import datetime, timedelta, timezone

    joao = client.get("/api/auth/me", headers=driver_headers).json()
    vehicle = next(v for v in client.get("/api/vehicles", headers=admin_headers).json() if v["current_driver_id"] == joao["id"])
    url = f"/api/vehicles/{vehicle['id']}"
    tire = client.post(f"{url}/tires", json={"position": "E1E", "measured_pct": 90}, headers=admin_headers).json()
    client.post(f"/api/tires/{tire['id']}/rotate", json={"position": "E1D"}, headers=admin_headers)
    delivery = client.get("/api/deliveries", headers=admin_headers).json()[0]
    client.post("/api/deliveries/assign", json={"delivery_ids": [delivery["id"]], "driver_id": joao["id"]}, headers=admin_headers)
    run = client.post("/api/delivery-runs", json={"day": delivery["scheduled_for"]}, headers=driver_headers).json()
    t = datetime.now(timezone.utc)
    client.post(f"/api/delivery-runs/{run['id']}/points", json={"points": [{"latitude": -19.93, "longitude": -44.05, "recorded_at": (t + timedelta(seconds=1)).isoformat()}]}, headers=driver_headers)

    usage = client.get(f"{url}/usage", headers=admin_headers).json()
    assert (usage["driver_name"], usage["runs"], usage["tires"], usage["active_run"]) == ("João Pereira", 1, 1, True)
    assert usage["positions"] > 0
    assert client.delete(url, headers=admin_headers).status_code == 409  # em rota
    client.post(f"/api/delivery-runs/{run['id']}/finish", headers=driver_headers)
    assert client.delete(url, headers=driver_headers).status_code == 403

    r = client.delete(url, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert (r.json()["plate"], r.json()["runs"], r.json()["tires"]) == ("RXY4B21", 1, 1) and r.json()["positions"] == usage["positions"]
    assert vehicle["id"] not in {v["id"] for v in client.get("/api/vehicles", headers=admin_headers).json()}
    assert client.get("/api/vehicles", headers=driver_headers).json() == []
    assert client.get("/api/tires", headers=admin_headers).json() == []
    assert all(p["vehicle_id"] != vehicle["id"] for p in client.get("/api/tracking/live", headers=admin_headers).json())
    assert client.get(f"/api/delivery-runs/{run['id']}", headers=admin_headers).status_code == 404
    # A entrega continua com o motorista
    assert next(d for d in client.get("/api/deliveries", headers=admin_headers).json() if d["id"] == delivery["id"])["driver_id"] == joao["id"]
    assert client.delete(url, headers=admin_headers).status_code == 404
