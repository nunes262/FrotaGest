from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DeliveryProof(Base):
    """Comprovante enviado pelo motorista no endereço: foto da entrega feita ou do cliente que não recebeu."""

    __tablename__ = "delivery_proofs"

    id: Mapped[int] = mapped_column(primary_key=True)
    delivery_id: Mapped[int] = mapped_column(ForeignKey("deliveries.id"), index=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    outcome: Mapped[str] = mapped_column(String(10))  # "delivered" ou "failed"
    # Para "failed": "absent" (ausente), "refused" (recusou), "address" (endereço não encontrado) ou "other"
    reason: Mapped[str | None] = mapped_column(String(10))
    note: Mapped[str | None] = mapped_column(String(500))
    photo_path: Mapped[str] = mapped_column(String(255))  # relativo à pasta de uploads
    # Quem recebeu (nome, documento e a assinatura feita na tela do celular)
    receiver_name: Mapped[str | None] = mapped_column(String(120))
    receiver_document: Mapped[str | None] = mapped_column(String(20))
    signature_path: Mapped[str | None] = mapped_column(String(255))
    # Gerado no celular: o mesmo registro reenviado (sem sinal) não vira um segundo comprovante
    client_id: Mapped[str | None] = mapped_column(String(36), index=True)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
