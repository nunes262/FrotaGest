from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.models import DeliveryStatus

FailureReason = Literal["absent", "refused", "address", "other"]


class ProofOut(BaseModel):
    """Comprovante mais recente da entrega (a foto sai em /deliveries/{id}/proof/photo)."""

    model_config = {"from_attributes": True}

    id: int
    driver_id: int
    outcome: Literal["delivered", "failed"]
    reason: FailureReason | None
    note: str | None
    latitude: float | None
    longitude: float | None
    created_at: datetime
    receiver_name: str | None = None
    receiver_document: str | None = None
    has_signature: bool = False


class DeliveryCreate(BaseModel):
    scheduled_for: date
    customer_name: str = Field(min_length=2, max_length=160)
    customer_phone: str | None = Field(default=None, max_length=20, description="Telefone do cliente (WhatsApp)")

    @field_validator("customer_phone")
    @classmethod
    def _phone(cls, value: str | None) -> str | None:
        """Só os números, com DDD (10 ou 11 dígitos; o 55 do Brasil é opcional)."""
        digits = "".join(c for c in value or "" if c.isdigit())
        if not digits:
            return None
        if digits.startswith("55") and len(digits) in (12, 13):
            digits = digits[2:]
        if len(digits) not in (10, 11):
            raise ValueError("Telefone com DDD, como (31) 98888-7777.")
        return digits
    address: str = Field(min_length=3, max_length=255)
    city: str = Field(min_length=2, max_length=120)
    invoice_number: str | None = Field(default=None, max_length=20)
    weight_kg: float = Field(gt=0)
    volumes: int | None = Field(default=None, ge=1)


class DeliveryOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    scheduled_for: date
    customer_name: str
    customer_phone: str | None = None
    address: str
    city: str
    invoice_number: str | None
    weight_kg: float
    volumes: int | None
    status: DeliveryStatus
    driver_id: int | None
    stop_order: int | None
    run_id: int | None = None
    # Ainda está no caminhão: a entregar, ou não recebida enquanto a rota não volta para a base
    on_board: bool = False
    proof: ProofOut | None = None


class DeliveryAssign(BaseModel):
    delivery_ids: list[int] = Field(min_length=1, description="Na ordem das paradas")
    driver_id: int | None = Field(description="Motorista que vai levar; nulo devolve para a fila de carregamento")
