from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RouteExpense(Base):
    """Despesa que o motorista pagou na rota (pedágio, estacionamento, descarga…), com a foto do comprovante.
    Aprovada pelo gestor, vira um reembolso a receber (driver_payments)."""

    __tablename__ = "route_expenses"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    run_id: Mapped[int | None] = mapped_column(ForeignKey("delivery_runs.id"), index=True)
    kind: Mapped[str] = mapped_column(String(12))  # "toll", "parking", "unloading", "meal" ou "other"
    amount_cents: Mapped[int] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(String(300))
    photo_path: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(10), default="pending")  # "pending", "approved" ou "rejected"
    reject_reason: Mapped[str | None] = mapped_column(String(200))
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payment_id: Mapped[int | None] = mapped_column(ForeignKey("driver_payments.id"))
    spent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    client_id: Mapped[str | None] = mapped_column(String(36), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
