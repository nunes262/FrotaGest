from app.integrations.base import TrackerAdapter
from app.integrations.mock import MockTrackerAdapter
from app.integrations.onixsat import OnixsatAdapter
from app.integrations.sascar import SascarAdapter

_ADAPTERS: dict[str, type[TrackerAdapter]] = {
    "mock": MockTrackerAdapter,
    "sascar": SascarAdapter,
    "onixsat": OnixsatAdapter,
}


def get_adapter(provider: str, credentials: dict | None = None) -> TrackerAdapter:
    try:
        return _ADAPTERS[provider](credentials)
    except KeyError as exc:
        raise ValueError(f"Rastreador não suportado: {provider}") from exc
