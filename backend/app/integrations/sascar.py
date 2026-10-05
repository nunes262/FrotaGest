"""Integração com a Sascar (Michelin Connected Fleet) pelo webservice SasIntegra (SOAP).

Contrato conferido no WSDL público (https://sasintegra.sascar.com.br/SasIntegra/SasIntegraWSService?wsdl) e no manual
"WebService SasIntegra v2.05". Pontos de atenção do manual:
- A autenticação usa o usuário e a senha de INTEGRADOR, liberados pela Sascar (nem sempre é o login do portal).
- Só 1 consulta de posições por vez por integradora; as simultâneas são recusadas.
- obterPacotePosicoes funciona como fila (cada pacote vem uma vez, até 3.000 por chamada) e só cobre D-1 e o dia atual:
  o FrotaGest precisa coletar sempre e guardar o histórico (app/workers/poller.py).
- O hodômetro não tem unidade documentada: os km são calculados pelos pontos, não por ele.
"""

from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

import httpx

from app.core.config import get_settings
from app.integrations.base import TrackerAdapter, TrackerError, TrackerPosition, TrackerVehicle

NAMESPACE = "http://webservice.web.integracao.sascar.com.br/"
TIMEOUT_S = 40
MAX_PACKETS = 3000
# Datas sem fuso vêm no horário de Brasília (as "Gmt" e a dataPacote vêm em GMT)
LOCAL_TZ = ZoneInfo("America/Sao_Paulo")


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _fields(node: ET.Element) -> dict[str, str]:
    return {_local(child.tag): (child.text or "").strip() for child in node}


def _parse_datetime(value: str, default_tz) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=default_tz)).astimezone(timezone.utc)


class SascarAdapter(TrackerAdapter):
    provider = "sascar"

    def _call(self, operation: str, **params) -> list[ET.Element]:
        """Chama uma operação e devolve os elementos <return> da resposta."""
        user, password = self.credentials.get("user"), self.credentials.get("password")
        if not user or not password:
            raise TrackerError("Credenciais da Sascar não configuradas para esta empresa.")
        args = "".join(
            f"<{k}>{escape(str(v))}</{k}>" for k, v in {"usuario": user, "senha": password, **params}.items() if v is not None
        )
        envelope = (
            '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" '
            f'xmlns:web="{NAMESPACE}"><soapenv:Header/><soapenv:Body>'
            f"<web:{operation}>{args}</web:{operation}></soapenv:Body></soapenv:Envelope>"
        )
        try:
            resp = httpx.post(
                self.credentials.get("url") or get_settings().sascar_url, content=envelope.encode(),
                headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": '""'}, timeout=TIMEOUT_S,
            )
        except httpx.HTTPError as e:
            raise TrackerError(f"A Sascar não respondeu: {e}") from e
        try:
            root = ET.fromstring(resp.content)
        except ET.ParseError as e:
            raise TrackerError(f"Resposta inesperada da Sascar (HTTP {resp.status_code}).") from e
        fault = next((n for n in root.iter() if _local(n.tag) == "faultstring"), None)
        if fault is not None or resp.status_code >= 400:
            raise TrackerError(f"A Sascar recusou: {(fault.text or '').strip() if fault is not None else f'HTTP {resp.status_code}'}")
        return [n for n in root.iter() if _local(n.tag) == "return"]

    def list_vehicles(self) -> list[TrackerVehicle]:
        out = []
        for node in self._call("obterVeiculos", quantidade=1000):
            f = _fields(node)
            if f.get("idVeiculo"):
                out.append(TrackerVehicle(external_id=f["idVeiculo"], plate=f.get("placa") or None, description=f.get("descricao") or None))
        return out

    def is_vehicle_integrated(self, external_vehicle_id: str) -> bool | None:
        nodes = self._call("verificarVeiculoIntegrado", idVeiculo=int(external_vehicle_id))
        return (nodes[0].text or "").strip().lower() == "true" if nodes else None

    def fetch_positions(self, external_vehicle_ids: list[str], since: datetime) -> list[TrackerPosition]:
        # A fila não repete pacotes e pode entregar posições atrasadas: não filtra por `since` (o worker deduplica)
        wanted = set(external_vehicle_ids)
        return [p for p in self.parse_positions(self._call("obterPacotePosicoes", quantidade=MAX_PACKETS)) if p.external_vehicle_id in wanted]

    def recent_positions(self, external_vehicle_id: str, hours: int = 24) -> list[TrackerPosition]:
        """Histórico do veículo (a Sascar guarda só D-1 e o dia atual). Não mexe na fila do worker."""
        end = datetime.now(LOCAL_TZ)
        start = end - timedelta(hours=min(hours, 47))
        nodes = self._call(
            "obterPacotePosicaoHistorico", dataInicio=f"{start:%Y-%m-%d %H:%M:%S}", dataFinal=f"{end:%Y-%m-%d %H:%M:%S}",
            idVeiculo=int(external_vehicle_id),
        )
        return self.parse_positions(nodes)

    @staticmethod
    def parse_positions(nodes: list[ET.Element]) -> list[TrackerPosition]:
        out = []
        for node in nodes:
            f = _fields(node)
            if "latitude" not in f or not f.get("idVeiculo"):
                continue  # pacote de mensagem ou evento, sem posição
            lat, lon = float(f["latitude"] or 0), float(f["longitude"] or 0)
            if lat == 0 and lon == 0:
                continue  # GPS sem sinal
            # Preferência: horário do GPS em GMT; na falta, o de gravação no servidor
            at = (
                _parse_datetime(f.get("dataPacoteGmt", ""), timezone.utc)
                or _parse_datetime(f.get("dataPacote", ""), timezone.utc)
                or _parse_datetime(f.get("dataPosicaoGmt", ""), timezone.utc)
                or _parse_datetime(f.get("dataPosicao", ""), LOCAL_TZ)
            )
            if not at:
                continue
            place = ", ".join(p for p in (f.get("rua"), "/".join(x for x in (f.get("cidade"), f.get("uf")) if x)) if p)
            out.append(TrackerPosition(
                external_vehicle_id=f["idVeiculo"],
                recorded_at=at,
                latitude=lat,
                longitude=lon,
                speed_kmh=float(f.get("velocidade") or 0),
                ignition=f.get("ignicao") == "1",
                external_driver_id=f.get("idMotorista") or None,
                address=place or None,
            ))
        return sorted(out, key=lambda p: p.recorded_at)
