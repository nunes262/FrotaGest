"""Preço do diesel e da gasolina pelo levantamento semanal da ANP.

A ANP publica toda semana uma planilha com o preço médio de revenda por município e por estado. Usamos o da
cidade da base quando ela está na pesquisa; senão, a média do estado.
"""

import io
import re
from dataclasses import dataclass
from datetime import date, datetime
from functools import lru_cache

import httpx
import openpyxl

from app.services.address import normalize

ANP_PAGE_URL = (
    "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/precos/"
    "levantamento-de-precos-de-combustiveis-ultimas-semanas-pesquisadas"
)
SPREADSHEET_RE = re.compile(r"https://[^\"']+resumo_semanal_lpc_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.xlsx")
TIMEOUT_S = 30
HEADERS = {"User-Agent": "Mozilla/5.0 (FrotaGest)"}

# Produto da planilha para cada tipo de combustível do veículo
PRODUCTS = {"diesel": "OLEO DIESEL S10", "gasolina": "GASOLINA COMUM"}

STATES = {
    "AC": "ACRE", "AL": "ALAGOAS", "AP": "AMAPA", "AM": "AMAZONAS", "BA": "BAHIA", "CE": "CEARA",
    "DF": "DISTRITO FEDERAL", "ES": "ESPIRITO SANTO", "GO": "GOIAS", "MA": "MARANHAO", "MT": "MATO GROSSO",
    "MS": "MATO GROSSO DO SUL", "MG": "MINAS GERAIS", "PA": "PARA", "PB": "PARAIBA", "PR": "PARANA",
    "PE": "PERNAMBUCO", "PI": "PIAUI", "RJ": "RIO DE JANEIRO", "RN": "RIO GRANDE DO NORTE",
    "RS": "RIO GRANDE DO SUL", "RO": "RONDONIA", "RR": "RORAIMA", "SC": "SANTA CATARINA", "SP": "SAO PAULO",
    "SE": "SERGIPE", "TO": "TOCANTINS",
}


class FuelPriceError(Exception):
    """A ANP não respondeu ou a planilha mudou de formato."""


@dataclass(frozen=True)
class AnpPrice:
    price: float
    place: str  # "Contagem/MG" ou "MG (média do estado)"
    week_start: date
    week_end: date

    @property
    def reference(self) -> str:
        return f"ANP · {self.place} · semana de {self.week_start:%d/%m} a {self.week_end:%d/%m/%Y}"


def place_from_address(address: str | None) -> tuple[str | None, str | None]:
    """(cidade, UF) do endereço da base: "Rua X, 10 - Contagem/MG" ou "Contagem - MG"."""
    m = re.search(r"([^,/\-]+?)\s*[/-]\s*([A-Za-z]{2})\s*$", address or "")
    if not m or m.group(2).upper() not in STATES:
        return None, None
    return m.group(1).strip(), m.group(2).upper()


def _get(url: str) -> httpx.Response:
    try:
        r = httpx.get(url, headers=HEADERS, timeout=TIMEOUT_S, follow_redirects=True)
        r.raise_for_status()
        return r
    except httpx.HTTPError as e:
        raise FuelPriceError(str(e)) from e


def latest_spreadsheet_url() -> str:
    found = {m.group(0): m.group(2) for m in SPREADSHEET_RE.finditer(_get(ANP_PAGE_URL).text)}
    if not found:
        raise FuelPriceError("Não achei a planilha semanal na página da ANP.")
    return max(found, key=found.get)  # a de data final mais recente


@lru_cache(maxsize=4)
def _download(url: str) -> bytes:
    return _get(url).content


def _rows(sheet) -> list[dict]:
    """Linhas da aba como dicionários, a partir do cabeçalho que começa com "DATA INICIAL"."""
    rows = sheet.iter_rows(values_only=True)
    for row in rows:
        if row and row[0] == "DATA INICIAL":
            header = [normalize(str(c)) if c else "" for c in row]
            break
    else:
        raise FuelPriceError(f"A aba {sheet.title} não tem o cabeçalho esperado.")
    return [dict(zip(header, r)) for r in rows if r and r[0]]


def _as_date(value) -> date:
    return value.date() if isinstance(value, datetime) else value


def parse_prices(content: bytes, city: str | None, uf: str) -> dict[str, AnpPrice]:
    """Preço de cada combustível na cidade (se pesquisada) ou a média do estado."""
    try:
        book = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        state = STATES[uf]
        wanted = {normalize(product): fuel for fuel, product in PRODUCTS.items()}
        found: dict[str, AnpPrice] = {}
        if city:
            for row in _rows(book["MUNICIPIOS"]):
                fuel = wanted.get(normalize(str(row.get("produto", ""))))
                if fuel and normalize(str(row.get("estado"))) == normalize(state) and normalize(str(row.get("municipio"))) == normalize(city):
                    found[fuel] = AnpPrice(float(row["preco medio revenda"]), f"{city}/{uf}", _as_date(row["data inicial"]), _as_date(row["data final"]))
        for row in _rows(book["ESTADOS"]):
            fuel = wanted.get(normalize(str(row.get("produto", ""))))
            if fuel and fuel not in found and normalize(str(row.get("estados"))) == normalize(state):
                found[fuel] = AnpPrice(float(row["preco medio revenda"]), f"{uf} (média do estado)", _as_date(row["data inicial"]), _as_date(row["data final"]))
    except (KeyError, ValueError, TypeError, OSError) as e:
        raise FuelPriceError(f"Formato inesperado da planilha da ANP: {e}") from e
    return found


def anp_prices(city: str | None, uf: str) -> dict[str, AnpPrice]:
    return parse_prices(_download(latest_spreadsheet_url()), city, uf)
