"""Rotina do motorista em volta da rota: comprovante com assinatura, checklist, abastecimento, despesas,
notificações e envio de registros feitos sem sinal."""

import json
from datetime import datetime, timedelta, timezone

import pytest

from tests.conftest import login

PHOTO = ("foto.jpg", b"\xff\xd8\xff\xe0 foto de teste", "image/jpeg")
SIGNATURE = ("assinatura.png", b"\x89PNG\r\n\x1a\n assinatura", "image/png")


def _me(client, headers):
    return client.get("/api/auth/me", headers=headers).json()


def _assign(client, admin_headers, driver_id, customers):
    pending = {d["customer_name"]: d for d in client.get("/api/deliveries", headers=admin_headers).json()}
    ids = [pending[c]["id"] for c in customers]
    assert client.post("/api/deliveries/assign", json={"delivery_ids": ids, "driver_id": driver_id}, headers=admin_headers).status_code == 200
    return pending[customers[0]]["scheduled_for"]


def _checklist(client, headers, problems: dict[str, str] | None = None, photo_for: str | None = None):
    items = client.get("/api/checklists/items", headers=headers).json()
    problems = problems or {}
    answers = [{"key": i["key"], "ok": i["key"] not in problems, "note": problems.get(i["key"])} for i in items]
    files = {f"photo_{photo_for}": PHOTO} if photo_for else None
    return client.post("/api/checklists", data={"items": json.dumps(answers), "odometer_km": "48210"}, files=files, headers=headers)


def test_proof_with_receiver_signature_and_offline_resend(client, admin_headers, driver_headers):
    joao = _me(client, driver_headers)
    day = _assign(client, admin_headers, joao["id"], ["Armazém do Bairro"])
    delivery = next(d for d in client.get("/api/deliveries", params={"day": day}, headers=driver_headers).json() if d["status"] == "assigned")

    # Registrada sem sinal às 10h e enviada depois: vale a hora do celular, e o reenvio não duplica
    when = (datetime.now(timezone.utc) - timedelta(hours=2)).replace(microsecond=0)
    form = {"outcome": "delivered", "receiver_name": "Maria Souza", "receiver_document": "MG-12.345.678",
            "client_id": "c0ffee00-0000-4000-8000-000000000001", "recorded_at": when.isoformat()}
    r = client.post(f"/api/deliveries/{delivery['id']}/outcome", data=form, files={"photo": PHOTO, "signature": SIGNATURE}, headers=driver_headers)
    assert r.status_code == 200, r.text
    proof = r.json()["proof"]
    assert (proof["receiver_name"], proof["receiver_document"], proof["has_signature"]) == ("Maria Souza", "MG-12.345.678", True)
    assert datetime.fromisoformat(proof["created_at"]) == when
    again = client.post(f"/api/deliveries/{delivery['id']}/outcome", data=form, files={"photo": PHOTO}, headers=driver_headers)
    assert again.status_code == 200 and again.json()["proof"]["id"] == proof["id"]
    signature = client.get(f"/api/deliveries/{delivery['id']}/proof/signature", headers=admin_headers)
    assert signature.status_code == 200 and signature.content == SIGNATURE[1]

    # Telefone do cliente para avisar pelo WhatsApp
    body = {"scheduled_for": day, "customer_name": "Padaria Teste", "address": "Rua A, 10", "city": "Contagem", "weight_kg": 50}
    assert client.post("/api/deliveries", json={**body, "customer_phone": "(31) 98888-7777"}, headers=admin_headers).json()["customer_phone"] == "31988887777"
    assert client.post("/api/deliveries", json={**body, "customer_phone": "+55 31 3333-4444"}, headers=admin_headers).json()["customer_phone"] == "3133334444"
    assert client.post("/api/deliveries", json={**body, "customer_phone": "1234"}, headers=admin_headers).status_code == 422


def test_checklist_before_leaving_goes_with_the_route(client, admin_headers, driver_headers):
    joao = _me(client, driver_headers)
    day = _assign(client, admin_headers, joao["id"], ["Armazém do Bairro"])
    assert len(client.get("/api/checklists/items", headers=driver_headers).json()) == 8

    bad = client.post("/api/checklists", data={"items": json.dumps([{"key": "brakes", "ok": True}])}, headers=driver_headers)
    assert bad.status_code == 422 and "todos os itens" in bad.json()["detail"]
    assert _checklist(client, driver_headers, {"lights": ""}).status_code == 422  # problema sem dizer qual

    r = _checklist(client, driver_headers, {"lights": "Seta direita queimada"}, photo_for="lights")
    assert r.status_code == 201, r.text
    checklist = r.json()
    assert (checklist["issues"], checklist["odometer_km"]) == (1, 48210)
    lights = next(i for i in checklist["items"] if i["key"] == "lights")
    assert (lights["ok"], lights["note"], lights["has_photo"]) == (False, "Seta direita queimada", True)

    # Sai com o checklist: o gestor é avisado da pendência e vê na rota
    admin_token = admin_headers["Authorization"].removeprefix("Bearer ")
    with client.websocket_connect(f"/api/chat/ws?token={admin_token}") as ws:
        run = client.post("/api/delivery-runs", json={"day": day, "checklist_id": checklist["id"]}, headers=driver_headers).json()
        events = [ws.receive_json() for _ in range(2)]
    issue = next(e for e in events if e["type"] == "checklist_issues")["data"]
    assert (issue["issues"], issue["driver_name"], issue["checklist_id"]) == (1, "João Pereira", checklist["id"])
    assert run["checklist"] == {"id": checklist["id"], "issues": 1}
    listed = client.get("/api/delivery-runs", params={"day": day}, headers=admin_headers).json()
    assert listed[0]["checklist"]["issues"] == 1
    photo = client.get(f"/api/checklists/{checklist['id']}/photos/lights", headers=admin_headers)
    assert photo.status_code == 200 and photo.content == PHOTO[1]
    other = login(client, "222.222.222-22", "motorista123")
    assert client.get(f"/api/checklists/{checklist['id']}", headers=other).status_code == 404


def test_fuel_entry_shows_real_spend_in_costs(client, admin_headers, driver_headers):
    form = {"liters": "42.5", "total": "290.00", "odometer_km": "48300", "fuel_type": "diesel", "station": "Posto BR Contagem",
            "client_id": "f0e1d2c3-0000-4000-8000-000000000002"}
    r = client.post("/api/fuel-entries", data=form, files={"photo": PHOTO}, headers=driver_headers)
    assert r.status_code == 201, r.text
    entry = r.json()
    assert (entry["liters"], entry["total"], entry["price_per_liter"], entry["plate"]) == (42.5, 290.0, 6.824, "RXY4B21")
    assert client.post("/api/fuel-entries", data=form, files={"photo": PHOTO}, headers=driver_headers).json()["id"] == entry["id"]
    typo = client.post("/api/fuel-entries", data={**form, "client_id": "", "total": "2900"}, files={"photo": PHOTO}, headers=driver_headers)
    assert typo.status_code == 422 and "Confira os litros" in typo.json()["detail"]
    assert client.post("/api/fuel-entries", data=form, headers=driver_headers).status_code == 422  # sem a foto do cupom

    assert [e["id"] for e in client.get("/api/fuel-entries", headers=admin_headers).json()] == [entry["id"]]
    costs = client.get("/api/costs/summary", headers=admin_headers).json()
    row = next(v for v in costs["vehicles"] if v["plate"] == "RXY4B21")
    assert (row["refuel_liters"], row["refuel_spent"], row["refuel_count"]) == (42.5, 290.0, 1)
    assert costs["refuel_spent"] == 290.0
    assert client.get(f"/api/fuel-entries/{entry['id']}/photo", headers=admin_headers).content == PHOTO[1]


def test_route_expense_is_approved_into_reimbursement(client, admin_headers, driver_headers):
    joao = _me(client, driver_headers)
    day = _assign(client, admin_headers, joao["id"], ["Armazém do Bairro"])
    run = client.post("/api/delivery-runs", json={"day": day}, headers=driver_headers).json()

    admin_token = admin_headers["Authorization"].removeprefix("Bearer ")
    with client.websocket_connect(f"/api/chat/ws?token={admin_token}") as ws:
        r = client.post("/api/expenses", data={"kind": "toll", "amount": "12.40", "note": "Praça de Betim"}, files={"photo": PHOTO}, headers=driver_headers)
        assert r.status_code == 201, r.text
        assert ws.receive_json() == {"type": "expense_submitted", "data": {"id": r.json()["id"], "driver_name": "João Pereira", "kind_label": "Pedágio", "amount": 12.4}}
    toll = r.json()
    assert (toll["status"], toll["run_id"], toll["kind_label"]) == ("pending", run["id"], "Pedágio")
    parking = client.post("/api/expenses", data={"kind": "parking", "amount": "15"}, files={"photo": PHOTO}, headers=driver_headers).json()
    assert {e["id"] for e in client.get("/api/expenses", params={"status": "pending"}, headers=admin_headers).json()} == {toll["id"], parking["id"]}

    # Recusar pede o motivo; aprovar vira reembolso a receber
    assert client.post(f"/api/expenses/{parking['id']}/review", json={"approve": False}, headers=admin_headers).status_code == 422
    rejected = client.post(f"/api/expenses/{parking['id']}/review", json={"approve": False, "reason": "Sem nota fiscal legível"}, headers=admin_headers).json()
    assert (rejected["status"], rejected["reject_reason"]) == ("rejected", "Sem nota fiscal legível")
    assert client.post(f"/api/expenses/{toll['id']}/review", json={"approve": True}, headers=driver_headers).status_code == 403
    approved = client.post(f"/api/expenses/{toll['id']}/review", json={"approve": True}, headers=admin_headers).json()
    assert (approved["status"], approved["payment_status"]) == ("approved", "pending")
    assert client.post(f"/api/expenses/{toll['id']}/review", json={"approve": True}, headers=admin_headers).status_code == 409

    mine = client.get("/api/payments/overview", headers=driver_headers).json()
    reimbursement = next(p for p in mine["payments"] if p["description"].startswith("Reembolso"))
    assert reimbursement["amount"] == 12.4 and reimbursement["description"].startswith("Reembolso · Pedágio")
    assert mine["balances"][0]["pending_amount"] == pytest.approx(12.4)
    history = client.get("/api/delivery-runs/history", headers=driver_headers).json()
    assert [(e["kind"], e["status"]) for e in history[0]["expenses"]] == [("toll", "approved"), ("parking", "rejected")]


def test_push_goes_only_to_devices_of_who_is_offline(client, admin_headers, driver_headers, monkeypatch, tmp_path):
    from app.core.config import get_settings
    from app.services import notify, push

    monkeypatch.setattr(get_settings(), "vapid_key_file", str(tmp_path / "vapid.pem"))
    monkeypatch.setattr(push, "_vapid", None)
    sent = []
    monkeypatch.setattr(push, "webpush", lambda info, data, **kw: sent.append((info["endpoint"], json.loads(data))))

    key = client.get("/api/push/public-key", headers=driver_headers).json()["key"]
    assert len(key) == 87  # ponto P-256 sem compressão, em base64url
    sub = {"endpoint": "https://push.example.com/joao-celular", "keys": {"p256dh": "BPk", "auth": "xyz"}}
    assert client.post("/api/push/subscriptions", json=sub, headers=driver_headers).status_code == 204
    assert client.get("/api/push/subscriptions/me", headers=driver_headers).json() == {"devices": 1}

    # App fechado: a carga nova vira notificação no celular
    joao = _me(client, driver_headers)
    _assign(client, admin_headers, joao["id"], ["Armazém do Bairro"])
    assert sent and sent[-1][0] == sub["endpoint"]
    assert sent[-1][1]["title"] == "Você recebeu um carregamento" and sent[-1][1]["url"] == "/minha-rota"

    # App aberto: o aviso chega pela tela e não duplica no celular
    sent.clear()
    token = driver_headers["Authorization"].removeprefix("Bearer ")
    with client.websocket_connect(f"/api/chat/ws?token={token}") as ws:
        _assign(client, admin_headers, joao["id"], ["Empório Central"])
        assert ws.receive_json()["type"] == "deliveries_assigned"
    assert sent == []

    assert notify.push_text({"type": "positions", "vehicle_id": 1}) is None
    assert notify.push_text({"type": "payments_changed", "data": {"kind": "paid", "amount": 1234.5, "count": 1}})[0] == "Pagamento registrado: R$ 1.234,50"
    assert client.post("/api/push/subscriptions/remove", json={"endpoint": sub["endpoint"]}, headers=driver_headers).status_code == 204
    assert client.get("/api/push/subscriptions/me", headers=driver_headers).json() == {"devices": 0}
