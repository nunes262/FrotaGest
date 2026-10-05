from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FuelEntry(Base):
    """Abastecimento registrado pelo motorista: litros, valor, hodômetro e a foto do cupom."""

    __tablename__ = "fuel_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), index=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    run_id: Mapped[int | None] = mapped_column(ForeignKey("delivery_runs.id"))
    filled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    liters: Mapped[float] = mapped_column(Float)
    total_cents: Mapped[int] = mapped_column(Integer)
    odometer_km: Mapped[float | None] = mapped_column(Float)
    fuel_type: Mapped[str] = mapped_column(String(10))
    full_tank: Mapped[bool] = mapped_column(Boolean, default=True)
    station: Mapped[str | None] = mapped_column(String(120))
    photo_path: Mapped[str] = mapped_column(String(255))
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    client_id: Mapped[str | None] = mapped_column(String(36), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
