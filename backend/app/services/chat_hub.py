import asyncio
from collections import defaultdict

from fastapi import WebSocket


class ChatHub:
    """Mantém as conexões WebSocket abertas por usuário (em memória). Leva as mensagens do chat
    e os avisos de carregamento. Para rodar com vários processos/servidores, troque por Redis Pub/Sub."""

    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)

    async def connect(self, user_id: int, ws: WebSocket) -> None:
        await ws.accept()
        self._connections[user_id].add(ws)

    def is_online(self, user_id: int) -> bool:
        """Com o app aberto (WebSocket conectado), o aviso chega pela tela; a notificação do celular fica para quem fechou."""
        return bool(self._connections.get(user_id))

    def disconnect(self, user_id: int, ws: WebSocket) -> None:
        self._connections[user_id].discard(ws)

    async def close_user(self, user_id: int, code: int = 4401) -> None:
        """Derruba as conexões do usuário (ex.: motorista removido). O código 4401 diz ao app para não reconectar."""
        for ws in list(self._connections.pop(user_id, ())):
            try:
                await ws.close(code=code)
            except RuntimeError:
                pass  # já estava fechada

    async def send_to_users(self, user_ids: list[int], payload: dict) -> None:
        sockets = [ws for uid in user_ids for ws in list(self._connections.get(uid, ()))]
        await asyncio.gather(*(ws.send_json(payload) for ws in sockets), return_exceptions=True)


hub = ChatHub()
