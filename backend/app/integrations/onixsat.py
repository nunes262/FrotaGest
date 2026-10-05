"""Integração com a Onixsat via webservice XML.

A documentação e as credenciais são fornecidas pela Onixsat ao cliente.
TODO: implementar a chamada e o parser seguindo o manual da versão contratada.
"""

from datetime import datetime

from app.integrations.base import TrackerAdapter, TrackerPosition


class OnixsatAdapter(TrackerAdapter):
    provider = "onixsat"

    def fetch_positions(self, external_vehicle_ids: list[str], since: datetime) -> list[TrackerPosition]:
        raise NotImplementedError(
            "Integração Onixsat ainda não implementada: solicite o manual do webservice à Onixsat."
        )
