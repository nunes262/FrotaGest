import os
import tempfile

os.environ["DATABASE_URL"] = "sqlite:///./test_frotagest.db"
os.environ["JWT_SECRET"] = "test-secret"
os.environ["UPLOAD_DIR"] = tempfile.mkdtemp(prefix="frotagest-uploads-")
# O rastreador simulado anda só quando o teste chama simulator.tick_all
os.environ["SIMULATOR_TICK_SECONDS"] = "0"

import pytest
from fastapi.testclient import TestClient

from app.db.base import Base
from app.db.session import engine


# Coordenadas de mentira por cidade (perto das reais), com um deslocamento pequeno por endereço
FAKE_CITIES = {
    "ipatinga": (-19.47, -42.53), "sete lagoas": (-19.46, -44.24), "governador valadares": (-18.85, -41.94),
    "belo horizonte": (-19.92, -43.94), "betim": (-19.96, -44.20), "contagem": (-19.93, -44.07),
}


@pytest.fixture(autouse=True)
def offline_maps(monkeypatch):
    """Nominatim, OSRM e ANP de mentira: os testes não dependem da internet. Devolve as buscas feitas no geocodificador."""
    from datetime import date

    from app.services import address, fuel, geocoding, routing

    searches = []

    def fake_search(q, limit=5, near=None):
        searches.append(q)
        key = address.normalize(q)
        for city, (lat, lon) in FAKE_CITIES.items():
            if city in key:
                shift = (sum(map(ord, q)) % 50) / 10_000
                return [{"lat": str(lat + shift), "lon": str(lon + shift), "display_name": q}]
        return []

    def no_osrm(path, params):
        raise routing.RoutingError("sem internet nos testes")

    def fake_anp(city, uf):
        week = (date(2026, 9, 27), date(2026, 10, 3))
        return {"diesel": fuel.AnpPrice(6.94, f"{city}/{uf}", *week), "gasolina": fuel.AnpPrice(6.39, f"{city}/{uf}", *week)}

    monkeypatch.setattr(geocoding, "search", fake_search)
    monkeypatch.setattr(geocoding, "reverse_place", lambda lat, lon: ("Contagem", "MG"))
    monkeypatch.setattr(routing, "_osrm_request", no_osrm)
    monkeypatch.setattr(fuel, "anp_prices", fake_anp)
    return searches


@pytest.fixture()
def client():
    from app.main import app
    from app.seed import seed

    Base.metadata.drop_all(bind=engine)
    seed()
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(bind=engine)


def login(client, login, password):
    r = client.post("/api/auth/login", json={"login": login, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture()
def admin_headers(client):
    return login(client, "gestor@frotagest.dev", "gestor123")


@pytest.fixture()
def driver_headers(client):
    return login(client, "111.111.111-11", "motorista123")
