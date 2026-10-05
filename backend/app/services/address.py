"""Sugestões de endereço: cidades pela lista de municípios do IBGE e ruas/CEP pelo ViaCEP.

O ViaCEP não busca cidades por nome, só ruas (com UF e cidade) e CEP. Por isso as cidades vêm do IBGE,
que é a mesma base de municípios que o ViaCEP usa.
"""

import re
import unicodedata
from functools import lru_cache

import httpx

IBGE_MUNICIPIOS_URL = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado"
VIACEP_URL = "https://viacep.com.br/ws"
TIMEOUT_S = 6
MAX_SUGGESTIONS = 8
CEP_RE = re.compile(r"^\d{5}-?\d{3}$")

# Tipo de via digitado no começo da busca ("Av Amazonas"). O ViaCEP não acha "Av Amazonas",
# então a busca vai só com o nome e o tipo serve para ordenar as sugestões.
STREET_TYPES = {
    "r": "rua", "rua": "rua",
    "av": "avenida", "avenida": "avenida",
    "al": "alameda", "alameda": "alameda",
    "tv": "travessa", "trav": "travessa", "travessa": "travessa",
    "pc": "praca", "pca": "praca", "praca": "praca",
    "rod": "rodovia", "rodovia": "rodovia",
    "est": "estrada", "estrada": "estrada",
}


class AddressLookupError(Exception):
    """O IBGE ou o ViaCEP não responderam."""


def normalize(text: str) -> str:
    """Sem acentos, minúsculo e só letras/números: "São João d'Aliança" → "sao joao d alianca"."""
    plain = unicodedata.normalize("NFD", text).encode("ascii", "ignore").decode()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", plain.lower()).split())


def _get_json(url: str, params: dict | None = None):
    try:
        r = httpx.get(url, params=params, timeout=TIMEOUT_S)
        r.raise_for_status()
        return r.json()
    except (httpx.HTTPError, ValueError) as e:
        raise AddressLookupError(str(e)) from e


@lru_cache(maxsize=1)
def municipalities() -> tuple[tuple[str, str, str], ...]:
    """(nome, UF, nome normalizado) dos 5.570 municípios. Baixa uma vez e fica em memória;
    se o IBGE falhar, nada é guardado e a próxima busca tenta de novo."""
    rows = _get_json(IBGE_MUNICIPIOS_URL)
    return tuple((m["municipio-nome"], m["UF-sigla"], normalize(m["municipio-nome"])) for m in rows)


def search_cities(q: str) -> list[dict]:
    key = normalize(q)
    if len(key) < 2:
        return []
    ranked = []
    for name, uf, norm in municipalities():
        if norm == key:
            rank = 0
        elif norm.startswith(key):
            rank = 1
        elif f" {key}" in f" {norm}":  # começo de outra palavra: "lagoas" → Sete Lagoas
            rank = 2
        elif key in norm:
            rank = 3
        else:
            continue
        ranked.append((rank, norm, uf, name))
    ranked.sort()
    return [{"name": name, "uf": uf} for _, _, uf, name in ranked[:MAX_SUGGESTIONS]]


def resolve_uf(city: str) -> str | None:
    """UF da cidade quando o nome é único no país (há várias "Bom Jesus", por exemplo)."""
    key = normalize(city)
    ufs = {uf for _, uf, norm in municipalities() if norm == key}
    return ufs.pop() if len(ufs) == 1 else None


def _suggestion(row: dict) -> dict:
    return {
        "street": row.get("logradouro") or "",
        "district": row.get("bairro") or "",
        "city": row["localidade"],
        "uf": row["uf"],
        "cep": row["cep"],
    }


def lookup_cep(cep: str) -> list[dict]:
    digits = re.sub(r"\D", "", cep)
    row = _get_json(f"{VIACEP_URL}/{digits}/json/")
    return [] if not isinstance(row, dict) or row.get("erro") else [_suggestion(row)]


@lru_cache(maxsize=512)
def _viacep_streets(uf: str, city: str, name: str) -> tuple[dict, ...]:
    rows = _get_json(f"{VIACEP_URL}/{uf}/{city}/{name}/json/")
    return tuple(rows) if isinstance(rows, list) else ()


def split_street_query(q: str) -> tuple[str | None, str]:
    """"Av. Amazonas, 5100" → ("avenida", "amazonas"): tira o número e o tipo de via."""
    words = normalize(q.split(",")[0]).split()
    while words and words[-1].isdigit():
        words.pop()
    street_type = STREET_TYPES.get(words[0]) if words else None
    if street_type:
        words = words[1:]  # só "Rua" ainda não é busca
    return street_type, " ".join(words)


def search_streets(q: str, city: str | None, uf: str | None) -> list[dict]:
    """Ruas da cidade que batem com o texto, sem repetir rua e bairro. Um CEP no lugar do nome devolve o endereço dele."""
    if CEP_RE.match(q.strip()):
        return lookup_cep(q.strip())
    street_type, name = split_street_query(q)
    if len(name) < 3 or not city or len(city.strip()) < 3:
        return []
    uf = (uf or resolve_uf(city) or "").upper()
    if not uf:
        return []

    seen: set[tuple[str, str]] = set()
    ranked = []
    for i, row in enumerate(_viacep_streets(uf, city.strip(), name)):
        item = _suggestion(row)
        key = (item["street"], item["district"])
        if key in seen:
            continue
        seen.add(key)
        street = normalize(item["street"])
        kind, _, bare = street.partition(" ")
        if kind not in STREET_TYPES.values():
            bare = street
        # Primeiro o tipo que a pessoa digitou ("Av" → Avenida), depois o nome que começa com o texto
        rank = (0 if not street_type or kind == street_type else 1, 0 if bare.startswith(name) else 1, i)
        ranked.append((rank, item))
    ranked.sort(key=lambda r: r[0])
    return [item for _, item in ranked[:MAX_SUGGESTIONS]]
