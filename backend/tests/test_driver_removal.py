"""Remover (demitir) e reativar motorista."""

import pytest
from starlette.websockets import WebSocketDisconnect

from tests.conftest import login

PHOTO = ("canhoto.jpg", b"\xff\xd8\xff\xe0 foto", "image/jpeg")


def test_remove_driver_frees_everything_but_keeps_history(client, admin_headers, driver_headers):
    me = client.get("/api/auth/me", headers=driver_headers).json()
    token = driver_headers["Authorization"].removeprefix("Bearer ")
    pending = {d["customer_name"]: d for d in client.get("/api/deliveries", headers=admin_headers).json()}
    names = ["Drogaria Vida", "Armazém do Bairro", "Empório Central"]
    ids = [pending[n]["id"] for n in names]
    client.post("/api/deliveries/assign", json={"delivery_ids": ids, "driver_id": me["id"]}, headers=admin_headers)
    run = client.post("/api/delivery-runs", json={"day": pending[names[0]]["scheduled_for"]}, headers=driver_headers).json()
    client.post(f"/api/deliveries/{ids[0]}/outcome", data={"outcome": "delivered"}, files={"photo": PHOTO}, headers=driver_headers)
    client.post(f"/api/deliveries/{ids[1]}/outcome", data={"outcome": "failed", "reason": "absent"}, files={"photo": PHOTO}, headers=driver_headers)

    assert client.delete(f"/api/drivers/{me['id']}", headers=driver_headers).status_code == 403
    with client.websocket_connect(f"/api/chat/ws?token={token}") as ws:
        r = client.delete(f"/api/drivers/{me['id']}", headers=admin_headers)
        assert r.status_code == 200, r.text
        # O app aberto do motorista é desconectado
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4401
    removal = r.json()
    assert (removal["driver"]["active"], removal["released_vehicles"], removal["returned_deliveries"], removal["finished_run"]) == (
        False, ["RXY4B21"], 2, True,
    )
    assert client.delete(f"/api/drivers/{me['id']}", headers=admin_headers).status_code == 409

    # Sem acesso: nem login, nem o token antigo
    assert client.post("/api/auth/login", json={"login": "11111111111", "password": "motorista123"}).status_code == 401
    assert client.get("/api/auth/me", headers=driver_headers).status_code == 401

    vehicle = next(v for v in client.get("/api/vehicles", headers=admin_headers).json() if v["plate"] == "RXY4B21")
    assert vehicle["current_driver_id"] is None
    by_id = {d["id"]: d for d in client.get("/api/deliveries", headers=admin_headers).json()}
    assert (by_id[ids[0]]["status"], by_id[ids[0]]["driver_id"]) == ("delivered", me["id"])  # histórico
    assert [(by_id[i]["status"], by_id[i]["driver_id"]) for i in ids[1:]] == [("pending", None), ("pending", None)]
    assert by_id[ids[1]]["proof"]["reason"] == "absent"  # a tentativa anterior continua registrada
    finished = client.get(f"/api/delivery-runs/{run['id']}", headers=admin_headers).json()
    assert finished["status"] == "finished"

    convs = client.get("/api/chat/conversations", headers=admin_headers).json()
    group = next(c for c in convs if c["kind"] == "group")
    direct = next(c for c in convs if c["kind"] == "direct" and c["name"] == "João Pereira")
    assert "João Pereira" not in {m["name"] for m in group["members"]}
    assert client.get(f"/api/chat/conversations/{direct['id']}/messages", headers=admin_headers).json()  # conversa guardada
    assert "João Pereira" not in {c["name"] for c in client.get("/api/chat/contacts", headers=admin_headers).json()}
    # O grupo continua editável sem ele
    others = [m["id"] for m in group["members"] if m["role"] == "driver"]
    assert client.put(f"/api/chat/conversations/{group['id']}", json={"name": group["name"], "member_ids": others}, headers=admin_headers).status_code == 200


def test_reactivate_removed_driver(client, admin_headers, driver_headers):
    me = client.get("/api/auth/me", headers=driver_headers).json()
    client.delete(f"/api/drivers/{me['id']}", headers=admin_headers)

    # Cadastrar de novo o CPF de alguém removido aponta para o "Reativar"
    ana = client.post("/api/drivers", json={"name": "Ana Lima", "cpf": "52998224725", "password": "segredo1"}, headers=admin_headers).json()
    client.delete(f"/api/drivers/{ana['id']}", headers=admin_headers)
    r = client.post("/api/drivers", json={"name": "Ana Lima", "cpf": "52998224725", "password": "outra123"}, headers=admin_headers)
    assert r.status_code == 409 and "Ana Lima" in r.json()["detail"] and "Reativar" in r.json()["detail"]

    taken = next(v for v in client.get("/api/vehicles", headers=admin_headers).json() if v["current_driver_id"])
    assert client.post(f"/api/drivers/{me['id']}/reactivate", json={"vehicle_id": taken["id"]}, headers=admin_headers).status_code == 409
    free = next(v for v in client.get("/api/vehicles", headers=admin_headers).json() if v["current_driver_id"] is None)
    r = client.post(f"/api/drivers/{me['id']}/reactivate", json={"vehicle_id": free["id"], "password": "nova1234"}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["active"] is True
    assert client.post(f"/api/drivers/{me['id']}/reactivate", json={}, headers=admin_headers).status_code == 409

    headers = login(client, "111.111.111-11", "nova1234")
    assert [v["id"] for v in client.get("/api/vehicles", headers=headers).json()] == [free["id"]]


def test_purge_removed_driver_deletes_everything_of_his(client, admin_headers, driver_headers):
    from datetime import datetime, timedelta, timezone
    from pathlib import Path

    from sqlalchemy import func, select

    from app.core.config import get_settings
    from app.db.session import SessionLocal
    from app.models import Conversation, DeliveryProof, DeliveryRun, Message, Position, RunPoint, User

    me = client.get("/api/auth/me", headers=driver_headers).json()
    vehicle = next(v for v in client.get("/api/vehicles", headers=admin_headers).json() if v["current_driver_id"] == me["id"])
    client.post(f"/api/vehicles/{vehicle['id']}/tires", json={"position": "E1E", "measured_pct": 90, "life_km": 50_000}, headers=admin_headers)

    pending = {d["customer_name"]: d for d in client.get("/api/deliveries", headers=admin_headers).json()}
    ids = [pending["Drogaria Vida"]["id"], pending["Armazém do Bairro"]["id"]]
    client.post("/api/deliveries/assign", json={"delivery_ids": ids, "driver_id": me["id"]}, headers=admin_headers)
    run = client.post("/api/delivery-runs", json={"day": pending["Drogaria Vida"]["scheduled_for"]}, headers=driver_headers).json()
    t = datetime.now(timezone.utc)
    client.post(f"/api/delivery-runs/{run['id']}/points", json={"points": [
        {"latitude": -19.932, "longitude": -44.0539, "recorded_at": (t + timedelta(seconds=1)).isoformat()},
        {"latitude": -19.866, "longitude": -44.0539, "recorded_at": (t + timedelta(minutes=4)).isoformat()},
    ]}, headers=driver_headers)
    client.post(f"/api/delivery-runs/{run['id']}/pauses", json={"kind": "meal"}, headers=driver_headers)
    client.post(f"/api/deliveries/{ids[0]}/outcome", data={"outcome": "delivered"}, files={"photo": PHOTO}, headers=driver_headers)
    group = next(c for c in client.get("/api/chat/conversations", headers=driver_headers).json() if c["kind"] == "group")
    client.post(f"/api/chat/conversations/{group['id']}/messages", json={"body": "Saindo do CD"}, headers=driver_headers)
    with SessionLocal() as db:
        photo = Path(get_settings().upload_dir) / db.scalar(select(DeliveryProof.photo_path).where(DeliveryProof.driver_id == me["id"]))
    assert photo.is_file()
    wear_before = next(t for t in client.get("/api/tires", headers=admin_headers).json() if t["vehicle_id"] == vehicle["id"])

    url = f"/api/drivers/{me['id']}/permanent"
    assert client.delete(url, headers=admin_headers).status_code == 409  # ainda ativo: remova antes
    client.delete(f"/api/drivers/{me['id']}", headers=admin_headers)
    other = login(client, "222.222.222-22", "motorista123")
    assert client.delete(url, headers=other).status_code == 403

    r = client.delete(url, headers=admin_headers)
    assert r.status_code == 200, r.text
    purge = r.json()
    assert (purge["name"], purge["runs"], purge["proofs"], purge["deliveries_kept"]) == ("João Pereira", 1, 1, 1)
    assert purge["gps_points"] >= 2 and purge["messages"] >= 2  # o grupo e a conversa individual com a gestora
    assert client.delete(url, headers=admin_headers).status_code == 404

    with SessionLocal() as db:
        assert db.get(User, me["id"]) is None
        assert db.scalar(select(func.count()).select_from(DeliveryRun).where(DeliveryRun.driver_id == me["id"])) == 0
        assert db.scalar(select(func.count()).select_from(RunPoint).where(RunPoint.run_id == run["id"])) == 0
        assert db.scalar(select(func.count()).select_from(Position).where(Position.driver_id == me["id"])) == 0
        assert db.scalar(select(func.count()).select_from(Message).where(Message.sender_id == me["id"])) == 0
        assert db.get(Conversation, group["id"]) is not None  # o grupo continua, sem as mensagens dele
    assert not photo.exists()
    assert "João Pereira" not in {d["name"] for d in client.get("/api/drivers", headers=admin_headers).json()}
    assert not any(c["name"] == "João Pereira" for c in client.get("/api/chat/conversations", headers=admin_headers).json())

    # A entrega feita fica no histórico da empresa, sem o nome nem a foto
    delivered = next(d for d in client.get("/api/deliveries", headers=admin_headers).json() if d["id"] == ids[0])
    assert (delivered["status"], delivered["driver_id"], delivered["proof"]) == ("delivered", None, None)
    # Os km rodados com o veículo continuam no desgaste do pneu
    wear_after = next(t for t in client.get("/api/tires", headers=admin_headers).json() if t["vehicle_id"] == vehicle["id"])
    assert wear_after["km_since_measure"] == wear_before["km_since_measure"] > 0
    assert wear_after["estimated_pct"] == wear_before["estimated_pct"]
