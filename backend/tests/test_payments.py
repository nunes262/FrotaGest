"""Pagamento dos motoristas: valor por rota ou conjunto de rotas, a pagar, pago e o que o motorista vê."""

import pytest

from tests.conftest import login


def _me(client, headers):
    return client.get("/api/auth/me", headers=headers).json()


def _assign(client, admin_headers, driver_id, customers):
    pending = {d["customer_name"]: d for d in client.get("/api/deliveries", headers=admin_headers).json()}
    ids = [pending[c]["id"] for c in customers]
    assert client.post("/api/deliveries/assign", json={"delivery_ids": ids, "driver_id": driver_id}, headers=admin_headers).status_code == 200
    return pending[customers[0]]["scheduled_for"]


def _run(client, headers, day):
    run = client.post("/api/delivery-runs", json={"day": day}, headers=headers).json()
    return client.post(f"/api/delivery-runs/{run['id']}/finish", headers=headers).json()


def test_route_value_is_the_region_price_and_driver_sees_what_to_receive(client, admin_headers, driver_headers):
    joao = _me(client, driver_headers)
    carla_headers = login(client, "222.222.222-22", "motorista123")
    carla = _me(client, carla_headers)
    token = driver_headers["Authorization"].removeprefix("Bearer ")

    # Rota em Contagem com entrega feita: ao encerrar, o preço da região já entra como valor a receber
    day = _assign(client, admin_headers, joao["id"], ["Armazém do Bairro"])
    run = client.post("/api/delivery-runs", json={"day": day}, headers=driver_headers).json()
    client.post(f"/api/deliveries/{run['stops'][0]['delivery']['id']}/outcome", data={"outcome": "delivered"}, files={"photo": PHOTO}, headers=driver_headers)
    with client.websocket_connect(f"/api/chat/ws?token={token}") as ws:
        r1 = client.post(f"/api/delivery-runs/{run['id']}/finish", headers=driver_headers).json()
        assert ws.receive_json() == {"type": "payments_changed", "data": {"kind": "created", "amount": 320.0, "count": 1}}

    # Rota em Betim encerrada sem registrar entrega: fica sem valor até o gestor lançar (sempre pelo preço da região)
    _assign(client, admin_headers, joao["id"], ["Distribuidora Betim Norte"])
    r2 = client.post("/api/delivery-runs", json={"day": day}, headers=driver_headers).json()
    r2 = client.post(f"/api/delivery-runs/{r2['id']}/finish", headers=driver_headers).json()
    _assign(client, admin_headers, carla["id"], ["Empório Central"])
    r3 = client.post("/api/delivery-runs", json={"day": day}, headers=carla_headers).json()
    client.post(f"/api/deliveries/{r3['stops'][0]['delivery']['id']}/outcome", data={"outcome": "delivered"}, files={"photo": PHOTO}, headers=carla_headers)
    client.post(f"/api/delivery-runs/{r3['id']}/finish", headers=carla_headers)

    overview = client.get("/api/payments/overview", headers=admin_headers).json()
    rows = {r["id"]: r for r in overview["runs"]}
    assert (rows[r1["id"]]["region_name"], rows[r1["id"]]["region_price"], rows[r1["id"]]["delivered"]) == ("Capital e Contagem", 320, 1)
    assert (rows[r2["id"]]["region_name"], rows[r2["id"]]["payment_id"]) == ("Região metropolitana", None)
    balance = {b["driver_name"]: b for b in overview["balances"]}
    assert (balance["João Pereira"]["pending_amount"], balance["João Pereira"]["unpriced_runs"]) == (320, 1)
    assert balance["Carla Mendes"]["pending_amount"] == 320

    # Não existe mais valor livre: só o preço da região
    assert client.post("/api/payments", json={"items": []}, headers=admin_headers).status_code in (404, 405)
    any_payment = overview["payments"][0]["id"]
    assert client.patch(f"/api/payments/{any_payment}", json={"amount": 1}, headers=admin_headers).status_code in (404, 405)
    assert client.delete(f"/api/payments/{any_payment}", headers=admin_headers).status_code in (404, 405)
    assert client.post(f"/api/payments/runs/{r2['id']}/launch", headers=driver_headers).status_code == 403
    launched = client.post(f"/api/payments/runs/{r2['id']}/launch", headers=admin_headers)
    assert launched.status_code == 201, launched.text
    assert (launched.json()["amount"], launched.json()["description"]) == (360.0, f"Rota de {day[8:10]}/{day[5:7]} · Região metropolitana")
    assert client.post(f"/api/payments/runs/{r2['id']}/launch", headers=admin_headers).status_code == 409

    # O motorista vê só o dele
    mine = client.get("/api/payments/overview", headers=driver_headers).json()
    assert [b["driver_id"] for b in mine["balances"]] == [joao["id"]]
    assert mine["balances"][0]["pending_amount"] == 680.0 and len(mine["payments"]) == 2
    assert {r["id"] for r in mine["runs"]} == {r1["id"], r2["id"]}

    # Pagar tudo do João (com aviso para ele), não paga duas vezes, desfaz e paga de novo
    ids = [p["id"] for p in mine["payments"]]
    with client.websocket_connect(f"/api/chat/ws?token={token}") as ws:
        paid = client.post("/api/payments/pay", json={"payment_ids": ids, "paid_on": day}, headers=admin_headers).json()
        assert ws.receive_json() == {"type": "payments_changed", "data": {"kind": "paid", "amount": 680.0, "count": 2}}
    assert {(p["status"], p["paid_on"]) for p in paid} == {("paid", day)}
    r = client.post("/api/payments/pay", json={"payment_ids": ids[:1]}, headers=admin_headers)
    assert r.status_code == 409 and "já foi pago" in r.json()["detail"]
    assert client.post(f"/api/payments/{ids[0]}/unpay", headers=admin_headers).json()["status"] == "pending"
    client.post("/api/payments/pay", json={"payment_ids": ids[:1]}, headers=admin_headers)
    balance = client.get("/api/payments/overview", headers=driver_headers).json()["balances"][0]
    assert (balance["pending_amount"], balance["paid_amount"], balance["paid_count"]) == (0, 680.0, 2)

    r = client.get("/api/payments/overview", params={"date_from": "2026-01-10", "date_to": "2026-01-01"}, headers=admin_headers)
    assert r.status_code == 422


PHOTO = ("canhoto.jpg", b"\xff\xd8\xff\xe0 foto de teste", "image/jpeg")


def test_load_stays_with_the_route_and_truck_empties_after_delivering(client, admin_headers, driver_headers):
    from sqlalchemy import update

    from app.db.session import SessionLocal, engine
    from app.db.upgrade import backfill_run_loads
    from app.models import Delivery, DeliveryRun

    joao = _me(client, driver_headers)
    day = _assign(client, admin_headers, joao["id"], ["Armazém do Bairro", "Empório Central", "Distribuidora Betim Norte"])
    run = client.post("/api/delivery-runs", json={"day": day}, headers=driver_headers).json()
    assert run["load_kg"] == 1680  # 310 + 390 + 980

    def truck():
        mine = {d["customer_name"]: d for d in client.get("/api/deliveries", params={"day": day}, headers=admin_headers).json()}
        mine = {k: d for k, d in mine.items() if d["driver_id"] == joao["id"] or d["run_id"] == run["id"]}
        return {k: d["on_board"] for k, d in mine.items()}, sum(d["weight_kg"] for d in mine.values() if d["on_board"])

    assert truck() == ({"Armazém do Bairro": True, "Empório Central": True, "Distribuidora Betim Norte": True}, 1680)
    ids = {s["delivery"]["customer_name"]: s["delivery"]["id"] for s in run["stops"]}
    client.post(f"/api/deliveries/{ids['Armazém do Bairro']}/outcome", data={"outcome": "delivered"}, files={"photo": PHOTO}, headers=driver_headers)
    client.post(f"/api/deliveries/{ids['Empório Central']}/outcome", data={"outcome": "failed", "reason": "absent"}, files={"photo": PHOTO}, headers=driver_headers)
    # A não recebida continua no caminhão até a rota voltar para a base
    assert truck()[1] == 390 + 980

    # O gestor tira uma entrega do caminhão no meio da rota: o peso sai da rota
    client.post("/api/deliveries/assign", json={"delivery_ids": [ids["Distribuidora Betim Norte"]], "driver_id": None}, headers=admin_headers)
    assert client.get(f"/api/delivery-runs/{run['id']}", headers=admin_headers).json()["load_kg"] == 700

    # De volta à base: o caminhão fica vazio e a rota guarda o peso que levou
    finished = client.post(f"/api/delivery-runs/{run['id']}/finish", headers=driver_headers).json()
    assert finished["load_kg"] == 700
    assert truck()[1] == 0
    row = next(r for r in client.get("/api/payments/overview", headers=admin_headers).json()["runs"] if r["id"] == run["id"])
    assert (row["load_kg"], row["delivered_kg"], row["deliveries"], row["delivered"], row["failed"]) == (700, 310, 2, 1, 1)

    # Rotas de antes desta versão (sem peso e sem o vínculo) são preenchidas ao iniciar o servidor
    with SessionLocal() as db:
        db.execute(update(Delivery).where(Delivery.run_id == run["id"]).values(run_id=None))
        db.execute(update(DeliveryRun).where(DeliveryRun.id == run["id"]).values(load_kg=None))
        db.commit()
    backfill_run_loads(engine)
    assert client.get(f"/api/delivery-runs/{run['id']}", headers=admin_headers).json()["load_kg"] == 700

