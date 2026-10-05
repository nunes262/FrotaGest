from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FuelPrice(Base):
    """Preço do litro usado no custo por km: o da ANP (média semanal da cidade ou do estado da base) ou um informado."""

    __tablename__ = "fuel_prices"
    __table_args__ = (UniqueConstraint("company_id", "fuel_type"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    fuel_type: Mapped[str] = mapped_column(String(10))  # "diesel" ou "gasolina"
    price_per_liter: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(10))  # "anp" ou "manual"
    # De onde veio: "ANP · Contagem/MG · semana de 27/09 a 03/10/2026"
    reference: Mapped[str | None] = mapped_column(String(160))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
