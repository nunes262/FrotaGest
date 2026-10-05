from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.models import ConversationKind, UserRole
from app.services.geo import as_utc


class ChatUser(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    role: UserRole


class ConversationOut(BaseModel):
    id: int
    kind: ConversationKind
    name: str
    members: list[ChatUser]
    last_message: str | None
    last_message_at: datetime | None
    last_message_sender_id: int | None
    last_message_sender_name: str | None
    unread_count: int

    @field_validator("last_message_at")
    @classmethod
    def _utc(cls, v: datetime | None) -> datetime | None:
        return as_utc(v) if v else v


class ConversationCreate(BaseModel):
    kind: ConversationKind
    name: str | None = None
    member_ids: list[int] = Field(min_length=1)


class GroupUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    member_ids: list[int] = Field(min_length=1)


class MessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class MessageOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    conversation_id: int
    sender_id: int
    sender_name: str | None = None
    body: str
    created_at: datetime

    # O SQLite devolve a data sem fuso; sem isso o navegador lê o horário UTC como se fosse local
    @field_validator("created_at")
    @classmethod
    def _utc(cls, v: datetime) -> datetime:
        return as_utc(v)
