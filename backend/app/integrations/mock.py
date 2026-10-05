import math
from datetime import datetime, timedelta, timezone

from app.integrations.base import TrackerAdapter, TrackerPosition

# Rotas de exemplo saindo de Contagem/MG (lat, lon)
ROUTES = [
    [(-19.9320, -44.0539), (-19.9000, -44.0100), (-19.8600, -43.9500), (-19.8200, -43.8800), (-19.7700, -43.7900)],
    [(-19.9320, -44.0539), (-19.8800, -44.0700), (-19.8000, -44.1000), (-19.7000, -44.1600), (-19.4660, -44.2470)],
    [(-19.9320, -44.0539), (-19.9600, -43.9900), (-19.9800, -43.9300), (-20.0100, -43.8600), (-20.0500, -43.8000)],
]


class MockTrackerAdapter(TrackerAdapter):
    """Simulador para desenvolver sem credenciais reais.
    Gera um ponto por minuto ao longo de uma das rotas de exemplo."""

    provider = "mock"

    def fetch_positions(self, external_vehicle_ids: list[str], since: datetime) -> list[TrackerPosition]:
        now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        since = since if since.tzinfo else since.replace(tzinfo=timezone.utc)
        out: list[TrackerPosition] = []
        for ext_id in external_vehicle_ids:
            t = max(since + timedelta(minutes=1), now - timedelta(hours=2)).replace(second=0, microsecond=0)
            while t <= now:
                out.append(self._position_at(ext_id, t))
                t += timedelta(minutes=1)
        return out

    @staticmethod
    def _position_at(ext_id: str, t: datetime) -> TrackerPosition:
        seed = sum(ord(c) for c in ext_id)
        route = ROUTES[seed % len(ROUTES)]
        # Percorre a rota em ~50 min, ida e volta (velocidade média compatível com a distância)
        cycle_min = 50
        minute = (t.hour * 60 + t.minute + seed * 7) % (cycle_min * 2)
        progress = minute / cycle_min if minute < cycle_min else 2 - minute / cycle_min
        seg_float = progress * (len(route) - 1)
        i = min(int(seg_float), len(route) - 2)
        f = seg_float - i
        lat = route[i][0] + (route[i + 1][0] - route[i][0]) * f
        lon = route[i][1] + (route[i + 1][1] - route[i][1]) * f
        speed = max(0.0, 62 + 30 * math.sin((minute + seed) / 9))
        stopped = (minute // 25) % 6 == 5  # paradas periódicas para entregas
        return TrackerPosition(
            external_vehicle_id=ext_id,
            recorded_at=t,
            latitude=round(lat, 6),
            longitude=round(lon, 6),
            speed_kmh=0.0 if stopped else round(speed, 1),
            ignition=not stopped,
        )
