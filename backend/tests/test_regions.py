"""Preço fixo da rota por região: tabela sugerida, região da rota, previsão antes de sair e lançamento automático."""

from tests.conftest import login

PHOTO = ("canhoto.jpg", b"\xff\xd8\xff\xe0 foto de teste", "image/jpeg")


def _me(client, headers):
    return client.get("/api/auth/me", headers=headers).json()


def _assign(client, admin_headers, driver_id, customers):
    pending = {d["customer_name"]: d for d in client.get("/api/deliveries", headers=admin_headers).json()}
    ids = [pending[c]["id"] for c in customers]
    assert client.post("/api/deliveries/assign", json={"delivery_ids": ids, "driver_id": driver_id}, headers=admin_headers).status_code == 200
    return pending[customers[0]]["scheduled_for"]


def test_route_price_comes_from_the_region_table(client, admin_headers, driver_headers):
    # A base do seed fica em Contagem: a sugestão usa os nomes e as cidades da Grande BH
    table = client.get("/api/route-regions", headers=driver_headers).json()
    assert [(r["name"], r["max_km"], r["price"]) for r in table["regions"]] == [
        ("Capital e Contagem", 15, 320), ("Região metropolitana", 40, 360), ("Interior próximo (até 100 km)", 100, 460),
        ("Interior (até 200 km)", 200, 600), ("Longa distância (acima de 200 km)", None, 950),
    ]
    assert table["has_base"] and "Betim" in table["regions"][1]["cities"]
    assert client.put("/api/route-regions", json={"regions": table["regions"]}, headers=driver_headers).status_code == 403

    # Contagem e Betim no mesmo caminhão: vale a região mais cara (metropolitana), não importa quantas entregas
    joao = _me(client, driver_headers)
    day = _assign(client, admin_headers, joao["id"], ["Armazém do Bairro", "Distribuidora Betim Norte"])
    estimate = client.get("/api/route-regions/estimate", params={"day": day}, headers=admin_headers).json()
    assert estimate == [{"driver_id": joao["id"], "region_name": "Região metropolitana", "price": 360, "unplaced": 0}]
    run = client.post("/api/delivery-runs", json={"day": day}, headers=driver_headers).json()
    assert (run["region_name"], run["region_price"]) == ("Região metropolitana", 360)

    # Entrega nova em Ipatinga (fora das listas, ~170 km da base): recalcular sobe para o interior
    _assign(client, admin_headers, joao["id"], ["Drogaria Vida"])
    run = client.post(f"/api/delivery-runs/{run['id']}/replan", headers=driver_headers).json()
    assert (run["region_name"], run["region_price"]) == ("Interior (até 200 km)", 600)

    # Ao encerrar com entregas feitas, o preço da região entra como valor a receber, com aviso para o motorista
    stop = run["stops"][0]["delivery"]["id"]
    client.post(f"/api/deliveries/{stop}/outcome", data={"outcome": "delivered"}, files={"photo": PHOTO}, headers=driver_headers)
    token = driver_headers["Authorization"].removeprefix("Bearer ")
    with client.websocket_connect(f"/api/chat/ws?token={token}") as ws:
        client.post(f"/api/delivery-runs/{run['id']}/finish", headers=driver_headers)
        assert ws.receive_json() == {"type": "payments_changed", "data": {"kind": "created", "amount": 600.0, "count": 1}}
    mine = client.get("/api/payments/overview", headers=driver_headers).json()
    assert [(p["amount"], p["description"], p["status"]) for p in mine["payments"]] == [
        (600.0, f"Rota de {day[8:10]}/{day[5:7]} · Interior (até 200 km)", "pending"),
    ]
    assert (mine["runs"][0]["region_name"], mine["runs"][0]["region_price"]) == ("Interior (até 200 km)", 600)

    # O gestor muda a tabela: rotas já feitas não mudam, as próximas usam o preço novo
    regions = table["regions"]
    regions[0] = {**regions[0], "price": 300, "cities": ["Belo Horizonte", "Contagem", "Betim"]}
    r = client.put("/api/route-regions", json={"regions": regions}, headers=admin_headers)
    assert r.status_code == 422 and "Betim está em duas regiões" in r.json()["detail"]
    regions[1] = {**regions[1], "cities": [c for c in regions[1]["cities"] if c != "Betim"]}
    two_open = [*regions, {"name": "Outra sem limite", "price": 999, "max_km": None, "cities": []}]
    assert client.put("/api/route-regions", json={"regions": two_open}, headers=admin_headers).status_code == 422
    saved = client.put("/api/route-regions", json={"regions": regions}, headers=admin_headers).json()
    assert saved["regions"][0]["price"] == 300
    assert client.get(f"/api/delivery-runs/{run['id']}", headers=admin_headers).json()["region_price"] == 600

    carla_headers = login(client, "222.222.222-22", "motorista123")
    carla = _me(client, carla_headers)
    day = _assign(client, admin_headers, carla["id"], ["Empório Central"])
    run = client.post("/api/delivery-runs", json={"day": day}, headers=carla_headers).json()
    assert (run["region_name"], run["region_price"]) == ("Capital e Contagem", 300)
    client.post(f"/api/deliveries/{run['stops'][0]['delivery']['id']}/outcome", data={"outcome": "delivered"}, files={"photo": PHOTO}, headers=carla_headers)
    client.post(f"/api/delivery-runs/{run['id']}/finish", headers=carla_headers)
    assert [p["amount"] for p in client.get("/api/payments/overview", headers=carla_headers).json()["payments"]] == [300.0]

    # Restaurar a sugestão
    reset = client.post("/api/route-regions/reset", headers=admin_headers).json()
    assert [r["price"] for r in reset["regions"]] == [320, 360, 460, 600, 950]
