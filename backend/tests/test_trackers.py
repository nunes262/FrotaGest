"""Integração com a Sascar (SasIntegra) contra um servidor de mentira no formato do WSDL oficial."""

from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree as ET

import httpx
import pytest

from app.db.session import SessionLocal
from app.integrations import sascar
from app.integrations.base import TrackerError
from app.models import Company

NS = "http://webservice.web.integracao.sascar.com.br/"


def _soap(operation: str, returns: list[str]) -> str:
    body = "".join(f"<return>{r}</return>" for r in returns)
    return (
        '<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body>'
        f'<ns2:{operation}Response xmlns:ns2="{NS}">{body}</ns2:{operation}Response></S:Body></S:Envelope>'
    )


def _packet(vehicle: int, when: datetime, lat: float, lon: float, speed: int = 0, ignition: int = 0, street: str = "") -> str:
    return (
        f"<idVeiculo>{vehicle}</idVeiculo><placa>QUG0208</placa><dataPosicao>{when.astimezone(sascar.LOCAL_TZ):%Y-%m-%dT%H:%M:%S}</dataPosicao>"
        f"<dataPacoteGmt>{when:%Y-%m-%dT%H:%M:%SZ}</dataPacoteGmt><latitude>{lat}</latitude><longitude>{lon}</longitude>"
        f"<velocidade>{speed}</velocidade><ignicao>{ignition}</ignicao><rua>{street}</rua><cidade>Contagem</cidade><uf>MG</uf>"
    )


@pytest.fixture()
def fake_sascar(monkeypatch):
    """Responde como o SasIntegra. Guarda os envelopes recebidos."""
    calls = []
    now = datetime.now(timezone.utc).replace(microsecond=0)

    def fake_post(url, content, headers, timeout):
        root = ET.fromstring(content)
        op = next(n for n in root.iter() if n.tag.startswith(f"{{{NS}}}"))
        name = op.tag.split("}")[1]
        args = {c.tag: (c.text or "") for c in op}
        calls.append((name, args, content.decode()))
        if args["usuario"] != "integrador" or args["senha"] != "s&nha<1>":
            fault = '<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><S:Fault><faultcode>S:Server</faultcode><faultstring>Usuário ou senha inválido.</faultstring></S:Fault></S:Body></S:Envelope>'
            return httpx.Response(500, content=fault.encode())
        if name == "obterVeiculos":
            vehicles = [
                "<idVeiculo>1591270</idVeiculo><placa>QUG0208</placa><descricao>QUG0208-1 (SASCARGA)</descricao>",
                "<idVeiculo>777</idVeiculo><placa>ABC1D23</placa><descricao>Outro</descricao>",
            ]
            return httpx.Response(200, content=_soap(name, vehicles).encode())
        if name == "verificarVeiculoIntegrado":
            return httpx.Response(200, content=_soap(name, ["true" if args["idVeiculo"] == "1591270" else "false"]).encode())
        if name == "obterPacotePosicaoHistorico":
            if args["idVeiculo"] != "1591270":
                return httpx.Response(200, content=_soap(name, []).encode())
            packets = [
                _packet(1591270, now - timedelta(minutes=12), -19.93, -44.05, 0, 0, "Rua A"),
                _packet(1591270, now - timedelta(minutes=8), 0, 0),  # sem sinal de GPS: ignorado
                _packet(1591270, now - timedelta(minutes=3), -19.92, -44.04, 46, 1, "Av. João César de Oliveira"),
            ]
            return httpx.Response(200, content=_soap(name, packets).encode())
        raise AssertionError(f"operação inesperada {name}")

    monkeypatch.setattr(sascar.httpx, "post", fake_post)
    return calls


def test_adapter_reads_positions_in_utc_and_escapes_credentials(fake_sascar):
    adapter = sascar.SascarAdapter({"user": "integrador", "password": "s&nha<1>"})
    positions = adapter.recent_positions("1591270")
    assert len(positions) == 2
    last = positions[-1]
    assert (last.latitude, last.speed_kmh, last.ignition, last.address) == (-19.92, 46, True, "Av. João César de Oliveira, Contagem/MG")
    assert last.recorded_at.tzinfo == timezone.utc and datetime.now(timezone.utc) - last.recorded_at < timedelta(minutes=4)
    name, args, envelope = fake_sascar[-1]
    assert name == "obterPacotePosicaoHistorico" and "<senha>s&amp;nha&lt;1&gt;</senha>" in envelope
    assert len(args["dataInicio"]) == 19 and args["dataInicio"][10] == " "  # AAAA-MM-DD HH:MM:SS

    with pytest.raises(TrackerError, match="Usuário ou senha inválido"):
        sascar.SascarAdapter({"user": "x", "password": "y"}).list_vehicles()


def test_connect_sascar_and_check_if_vehicle_is_transmitting(client, admin_headers, driver_headers, fake_sascar):
    car = client.post("/api/vehicles", json={"plate": "QUG0208", "model": "Fiat Ducato", "tracker_provider": "sascar", "tracker_external_id": "1591270"}, headers=admin_headers).json()

    wrong = client.put("/api/company/trackers/sascar", json={"user": "integrador", "password": "errada"}, headers=admin_headers)
    assert wrong.status_code == 400 and "Usuário ou senha inválido" in wrong.json()["detail"] and "Nada foi salvo" in wrong.json()["detail"]
    assert client.get("/api/company/trackers", headers=admin_headers).json() == [
        {"provider": "sascar", "configured": False, "user": None, "vehicles": []}
    ]
    assert client.put("/api/company/trackers/sascar", json={"user": "a", "password": "b"}, headers=driver_headers).status_code == 403

    r = client.put("/api/company/trackers/sascar", json={"user": " integrador ", "password": "s&nha<1>"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    connection = r.json()
    assert (connection["configured"], connection["user"]) == (True, "integrador")
    assert "password" not in r.text
    assert [(v["external_id"], v["vehicle_plate"]) for v in connection["vehicles"]] == [("1591270", "QUG0208"), ("777", None)]
    with SessionLocal() as db:
        assert db.get(Company, 1).tracker_credentials["sascar"] == {"user": "integrador", "password": "s&nha<1>"}

    check = client.post(f"/api/vehicles/{car['id']}/tracker-check", headers=admin_headers)
    assert check.status_code == 200, check.text
    result = check.json()
    assert (result["status"], result["positions_found"], result["stored"]) == ("transmitting", 2, 2)
    assert result["last"]["address"] == "Av. João César de Oliveira, Contagem/MG" and result["last"]["ignition"] is True
    # As posições já estão no mapa ao vivo
    live = next(p for p in client.get("/api/tracking/live", headers=admin_headers).json() if p["plate"] == "QUG0208")
    assert (live["latitude"], live["status"]) == (-19.92, "moving")
    assert client.post(f"/api/vehicles/{car['id']}/tracker-check", headers=admin_headers).json()["stored"] == 0

    other = client.post("/api/vehicles", json={"plate": "XYZ9A99", "tracker_provider": "sascar", "tracker_external_id": "555"}, headers=admin_headers).json()
    assert client.post(f"/api/vehicles/{other['id']}/tracker-check", headers=admin_headers).json()["status"] == "not_integrated"

    assert client.delete("/api/company/trackers/sascar", headers=admin_headers).status_code == 204
    gone = client.post(f"/api/vehicles/{car['id']}/tracker-check", headers=admin_headers)
    assert gone.status_code == 400 and "Credenciais da Sascar não configuradas" in gone.json()["detail"]
