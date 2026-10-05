from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, Response, WebSocket, WebSocketDisconnect, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.api.deps import AdminUser, CurrentUser, DbSession, user_from_token
from app.db.session import SessionLocal
from app.models import Conversation, ConversationKind, ConversationMember, Message, User, UserRole
from app.schemas.chat import ChatUser, ConversationCreate, ConversationOut, GroupUpdate, MessageCreate, MessageOut
from app.services.chat_hub import hub

router = APIRouter(prefix="/chat", tags=["chat"])


def _member_ids(db: Session, conversation_id: int) -> list[int]:
    return list(db.scalars(select(ConversationMember.user_id).where(ConversationMember.conversation_id == conversation_id)))


def _get_conversation(db: Session, conversation_id: int, user: User) -> Conversation:
    conv = db.get(Conversation, conversation_id)
    if not conv or conv.company_id != user.company_id or user.id not in _member_ids(db, conversation_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não encontrada.")
    return conv


def _company_users(db: Session, user_ids: set[int], company_id: int) -> list[User]:
    users = db.scalars(
        select(User).where(User.id.in_(user_ids), User.company_id == company_id, User.active.is_(True))
    ).all()
    if {u.id for u in users} != user_ids:
        raise HTTPException(400, "Algum participante não pertence à sua empresa.")
    return list(users)


def _conversation_out(db: Session, conv: Conversation, viewer: User) -> ConversationOut:
    members = db.scalars(
        select(User)
        .join(ConversationMember, ConversationMember.user_id == User.id)
        .where(ConversationMember.conversation_id == conv.id)
        .order_by(User.name)
    ).all()
    last = db.execute(
        select(Message, User.name)
        .join(User, User.id == Message.sender_id)
        .where(Message.conversation_id == conv.id)
        .order_by(Message.id.desc())
        .limit(1)
    ).first()
    last_read = db.scalar(
        select(ConversationMember.last_read_message_id).where(
            ConversationMember.conversation_id == conv.id, ConversationMember.user_id == viewer.id
        )
    )
    unread = select(func.count(Message.id)).where(Message.conversation_id == conv.id, Message.sender_id != viewer.id)
    if last_read:
        unread = unread.where(Message.id > last_read)

    if conv.kind == ConversationKind.group:
        name = conv.name or "Grupo"
    else:
        name = next((m.name for m in members if m.id != viewer.id), "Conversa")
    msg, sender_name = last if last else (None, None)
    return ConversationOut(
        id=conv.id,
        kind=conv.kind,
        name=name,
        members=[ChatUser.model_validate(m) for m in members],
        last_message=msg.body if msg else None,
        last_message_at=msg.created_at if msg else None,
        last_message_sender_id=msg.sender_id if msg else None,
        last_message_sender_name=sender_name,
        unread_count=db.scalar(unread) or 0,
    )


@router.get("/contacts", response_model=list[ChatUser])
def list_contacts(db: DbSession, user: CurrentUser):
    """Com quem o usuário pode conversar: o gestor fala com todos; o motorista, com a base (gestores)."""
    q = (
        select(User)
        .where(User.company_id == user.company_id, User.active.is_(True), User.id != user.id)
        .order_by(User.name)
    )
    if user.role == UserRole.driver:
        q = q.where(User.role == UserRole.admin)
    return db.scalars(q).all()


@router.get("/conversations", response_model=list[ConversationOut])
def list_conversations(db: DbSession, user: CurrentUser):
    convs = db.scalars(
        select(Conversation)
        .join(ConversationMember, ConversationMember.conversation_id == Conversation.id)
        .where(ConversationMember.user_id == user.id)
    ).all()
    oldest = datetime.min.replace(tzinfo=timezone.utc)
    out = [_conversation_out(db, c, user) for c in convs]
    return sorted(out, key=lambda c: c.last_message_at or oldest, reverse=True)


@router.post("/conversations", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
async def create_conversation(data: ConversationCreate, response: Response, db: DbSession, user: CurrentUser):
    member_ids = set(data.member_ids) | {user.id}
    members = _company_users(db, member_ids, user.company_id)

    if data.kind == ConversationKind.direct:
        if len(member_ids) != 2:
            raise HTTPException(400, "Conversa individual precisa de exatamente um outro participante.")
        other = next(m for m in members if m.id != user.id)
        if user.role == UserRole.driver and other.role != UserRole.admin:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Motoristas conversam com a base e nos grupos.")
        existing = db.scalar(
            select(Conversation)
            .join(ConversationMember, ConversationMember.conversation_id == Conversation.id)
            .where(
                Conversation.kind == ConversationKind.direct,
                Conversation.company_id == user.company_id,
                ConversationMember.user_id.in_(member_ids),
            )
            .group_by(Conversation.id)
            .having(func.count() == 2)
        )
        if existing:
            # Uma conversa individual por dupla: devolve a que já existe
            response.status_code = status.HTTP_200_OK
            return _conversation_out(db, existing, user)
        name = None
    else:
        if user.role != UserRole.admin:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Apenas gestores podem criar grupos.")
        name = (data.name or "").strip()
        if not name:
            raise HTTPException(400, "Dê um nome ao grupo.")

    conv = Conversation(company_id=user.company_id, kind=data.kind, name=name)
    db.add(conv)
    db.flush()
    db.add_all(ConversationMember(conversation_id=conv.id, user_id=m) for m in member_ids)
    db.commit()
    await hub.send_to_users(list(member_ids), {"type": "conversation", "data": {"id": conv.id}})
    return _conversation_out(db, conv, user)


@router.put("/conversations/{conversation_id}", response_model=ConversationOut)
async def update_group(conversation_id: int, data: GroupUpdate, db: DbSession, admin: AdminUser):
    """Renomeia o grupo e troca os participantes. Quem edita continua no grupo."""
    conv = _get_conversation(db, conversation_id, admin)
    if conv.kind != ConversationKind.group:
        raise HTTPException(400, "Só dá para editar grupos.")
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "Dê um nome ao grupo.")
    member_ids = set(data.member_ids) | {admin.id}
    _company_users(db, member_ids, admin.company_id)

    old_ids = set(_member_ids(db, conv.id))
    conv.name = name
    db.execute(
        delete(ConversationMember).where(
            ConversationMember.conversation_id == conv.id, ConversationMember.user_id.not_in(member_ids)
        )
    )
    db.add_all(ConversationMember(conversation_id=conv.id, user_id=m) for m in member_ids - old_ids)
    db.commit()
    await hub.send_to_users(list(old_ids | member_ids), {"type": "conversation", "data": {"id": conv.id}})
    return _conversation_out(db, conv, admin)


@router.post("/conversations/{conversation_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(conversation_id: int, db: DbSession, user: CurrentUser):
    _get_conversation(db, conversation_id, user)
    last_id = db.scalar(select(func.max(Message.id)).where(Message.conversation_id == conversation_id))
    db.execute(
        update(ConversationMember)
        .where(ConversationMember.conversation_id == conversation_id, ConversationMember.user_id == user.id)
        .values(last_read_message_id=last_id)
    )
    db.commit()


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
def list_messages(conversation_id: int, db: DbSession, user: CurrentUser, before_id: int | None = None, limit: int = Query(50, le=200)):
    _get_conversation(db, conversation_id, user)
    q = select(Message, User.name).join(User, User.id == Message.sender_id).where(Message.conversation_id == conversation_id)
    if before_id:
        q = q.where(Message.id < before_id)
    rows = db.execute(q.order_by(Message.id.desc()).limit(limit)).all()
    return [MessageOut(**MessageOut.model_validate(m).model_dump(exclude={"sender_name"}), sender_name=n) for m, n in reversed(rows)]


@router.post("/conversations/{conversation_id}/messages", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
async def send_message(conversation_id: int, data: MessageCreate, db: DbSession, user: CurrentUser):
    _get_conversation(db, conversation_id, user)
    msg = Message(conversation_id=conversation_id, sender_id=user.id, body=data.body.strip())
    db.add(msg)
    db.commit()
    db.refresh(msg)
    out = MessageOut(**MessageOut.model_validate(msg).model_dump(exclude={"sender_name"}), sender_name=user.name)
    await hub.send_to_users(_member_ids(db, conversation_id), {"type": "message", "data": out.model_dump(mode="json")})
    return out


@router.websocket("/ws")
async def chat_ws(ws: WebSocket, token: str = Query(...)):
    """Canal de tempo real. O cliente recebe {"type": "message", "data": {...}} a cada mensagem nova
    e {"type": "conversation", ...} quando entra num grupo ou um grupo muda. O envio é feito pelos POSTs acima.
    O motorista também recebe {"type": "deliveries_assigned", ...} quando ganha entregas e
    {"type": "deliveries_changed"} quando perde alguma (ver routes/deliveries.py)."""
    with SessionLocal() as db:
        try:
            user = user_from_token(db, token)
        except HTTPException:
            await ws.close(code=4401)
            return
    await hub.connect(user.id, ws)
    try:
        while True:
            await ws.receive_text()  # mantém a conexão viva (ping do cliente)
    except (WebSocketDisconnect, RuntimeError):  # RuntimeError: o servidor fechou (usuário removido)
        hub.disconnect(user.id, ws)
