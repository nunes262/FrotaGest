"""Avisos em tempo real: pela tela (WebSocket) para quem está com o app aberto e, para quem fechou, notificação no
celular (Web Push) com o texto e a tela que abre ao tocar."""

from app.services import push
from app.services.chat_hub import hub


def _brl(value: float) -> str:
    return f"R$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def push_text(payload: dict) -> tuple[str, str, str] | None:
    """Título, texto e tela da notificação de cada aviso (os de atualização de tela não viram notificação)."""
    data = payload.get("data") or {}
    match payload.get("type"):
        case "deliveries_assigned":
            return ("Você recebeu um carregamento",
                    f"{data['count']} entrega(s), {data['weight_kg']:g} kg, colocadas por {data['assigned_by']}.", "/minha-rota")
        case "payments_changed" if data.get("kind") == "created":
            return (f"Novo valor a receber: {_brl(data['amount'])}", "Lançado pela base.", "/rotas-feitas")
        case "payments_changed" if data.get("kind") == "paid":
            return (f"Pagamento registrado: {_brl(data['amount'])}", "A base marcou como pago.", "/rotas-feitas")
        case "delivery_outcome":
            title = f"Entregue: {data['customer_name']}" if data["outcome"] == "delivered" else f"Não entregue: {data['customer_name']}"
            return (title, f"{data['driver_name']} enviou o comprovante.", "/carregamento")
        case "expense_submitted":
            return (f"Despesa para aprovar: {_brl(data['amount'])}", f"{data['kind_label']} · {data['driver_name']}", "/pagamentos")
        case "expense_reviewed":
            verdict = "aprovada" if data["approved"] else "recusada"
            return (f"Despesa {verdict}: {_brl(data['amount'])}", data.get("reason") or data["kind_label"], "/rotas-feitas")
        case "checklist_issues":
            return (f"Saiu com {data['issues']} pendência(s) no checklist",
                    f"{data['driver_name']} · {data['plate']}", "/carregamento")
    return None


async def send(events: list[tuple[list[int], dict]]) -> None:
    for user_ids, payload in events:
        await hub.send_to_users(user_ids, payload)
        if text := push_text(payload):
            await push.notify(user_ids, *text)
