import pytest

from app.services import address

MUNICIPIOS = [
    {"municipio-nome": name, "UF-sigla": uf}
    for name, uf in [
        ("Ipatinga", "MG"), ("Belo Horizonte", "MG"), ("Sete Lagoas", "MG"),
        ("São João del Rei", "MG"), ("Bom Jesus", "PI"), ("Bom Jesus", "RS"),
    ]
]


def _row(street, district, cep, city="Belo Horizonte"):
    return {"logradouro": street, "bairro": district, "localidade": city, "uf": "MG", "cep": cep}


VIACEP = {
    "https://viacep.com.br/ws/MG/Belo Horizonte/amazonas/json/": [
        _row("Rua Amazonas", "Carlos Prates", "30710-000"),
        _row("Avenida Amazonas", "Centro", "30180-908"),
        _row("Avenida Amazonas", "Centro", "30180-904"),
        _row("Avenida Amazonas", "Gutierrez", "30441-001"),
    ],
    "https://viacep.com.br/ws/35160019/json/": _row("Rua Diamantina", "Centro", "35160-019", city="Ipatinga"),
    "https://viacep.com.br/ws/00000000/json/": {"erro": "true"},
}


@pytest.fixture()
def fake_apis(monkeypatch):
    """IBGE e ViaCEP de mentira: os testes não dependem da internet."""
    calls = []

    def fake_get_json(url, params=None):
        calls.append(url)
        if url == address.IBGE_MUNICIPIOS_URL:
            return MUNICIPIOS
        return VIACEP.get(url, [])

    address.municipalities.cache_clear()
    address._viacep_streets.cache_clear()
    monkeypatch.setattr(address, "_get_json", fake_get_json)
    yield calls
    address.municipalities.cache_clear()
    address._viacep_streets.cache_clear()


def test_city_suggestions_ignore_accents_and_show_uf(client, admin_headers, fake_apis):
    get = lambda q: client.get("/api/address/cities", params={"q": q}, headers=admin_headers).json()
    assert get("ipat") == [{"name": "Ipatinga", "uf": "MG"}]
    assert get("sao joao") == [{"name": "São João del Rei", "uf": "MG"}]
    assert get("lagoas") == [{"name": "Sete Lagoas", "uf": "MG"}]
    assert get("bom jesus") == [{"name": "Bom Jesus", "uf": "PI"}, {"name": "Bom Jesus", "uf": "RS"}]
    get("ipat")
    assert fake_apis.count(address.IBGE_MUNICIPIOS_URL) == 1  # a lista do IBGE fica em memória


def test_street_suggestions_from_viacep(client, admin_headers, fake_apis):
    params = {"q": "Av. Amazonas, 5100", "city": "Belo Horizonte"}  # sem UF: a cidade é única
    rows = client.get("/api/address/streets", params=params, headers=admin_headers).json()
    # Sem repetir rua e bairro, e primeiro o tipo de via digitado
    assert [(r["street"], r["district"]) for r in rows] == [
        ("Avenida Amazonas", "Centro"), ("Avenida Amazonas", "Gutierrez"), ("Rua Amazonas", "Carlos Prates"),
    ]
    assert rows[0] == {"street": "Avenida Amazonas", "district": "Centro", "city": "Belo Horizonte", "uf": "MG", "cep": "30180-908"}

    # Cidade que existe em mais de uma UF precisa ser escolhida na lista
    ambiguous = {"q": "Amazonas", "city": "Bom Jesus"}
    assert client.get("/api/address/streets", params=ambiguous, headers=admin_headers).json() == []
    assert client.get("/api/address/streets", params={"q": "Rua", "city": "Ipatinga"}, headers=admin_headers).json() == []


def test_street_suggestion_by_cep(client, admin_headers, fake_apis):
    rows = client.get("/api/address/streets", params={"q": "35160-019"}, headers=admin_headers).json()
    assert [(r["street"], r["city"], r["uf"]) for r in rows] == [("Rua Diamantina", "Ipatinga", "MG")]
    assert client.get("/api/address/streets", params={"q": "00000-000"}, headers=admin_headers).json() == []


def test_address_lookup_errors(client, admin_headers, monkeypatch):
    def offline(url, params=None):
        raise address.AddressLookupError("sem rede")

    address.municipalities.cache_clear()
    monkeypatch.setattr(address, "_get_json", offline)
    r = client.get("/api/address/cities", params={"q": "ipat"}, headers=admin_headers)
    assert r.status_code == 502 and "Digite o endereço normalmente" in r.json()["detail"]
    assert client.get("/api/address/cities", params={"q": "ipat"}).status_code == 401
