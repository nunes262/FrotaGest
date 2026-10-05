import enum
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DeliveryStatus(str, enum.Enum):
    pending = "pending"  # aguardando carregamento
    assigned = "assigned"  # já está no caminhão de um motorista
    delivered = "delivered"
    failed = "failed"  # o cliente não recebeu: motivo e foto ficam no comprovante


class Delivery(Base):
    """Entrega do dia. Na tela de carregamento o gestor distribui as pendentes entre os motoristas."""

    __tablename__ = "deliveries"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    scheduled_for: Mapped[date] = mapped_column(Date, index=True)
    customer_name: Mapped[str] = mapped_column(String(160))
    # Para o motorista avisar pelo WhatsApp que está chegando
    customer_phone: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str] = mapped_column(String(255))
    city: Mapped[str] = mapped_column(String(120))
    invoice_number: Mapped[str | None] = mapped_column(String(20))
    weight_kg: Mapped[float] = mapped_column(Float)
    volumes: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[DeliveryStatus] = mapped_column(Enum(DeliveryStatus), default=DeliveryStatus.pending)
    driver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    # Ordem de parada na rota do motorista
    stop_order: Mapped[int | None] = mapped_column(Integer)
    # Rota em que a entrega foi levada (o peso dela fica registrado lá)
    run_id: Mapped[int | None] = mapped_column(ForeignKey("delivery_runs.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
