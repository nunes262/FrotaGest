from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DriverPayment(Base):
    """Valor que a empresa combinou pagar ao motorista por uma rota ou por um conjunto de rotas (as rotas apontam
    para cá em delivery_runs.payment_id) e se já foi pago."""

    __tablename__ = "driver_payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    # Em centavos, para as somas não acumularem erro de arredondamento
    amount_cents: Mapped[int] = mapped_column(Integer)
    description: Mapped[str | None] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(10), default="pending")  # "pending" (a pagar) ou "paid"
    paid_on: Mapped[date | None] = mapped_column(Date)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
