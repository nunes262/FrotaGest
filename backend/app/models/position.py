from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Position(Base):
    """Ponto recebido do rastreador. Guardamos o histórico aqui porque provedores
    como a Sascar só mantêm D0/D1."""

    __tablename__ = "positions"
    __table_args__ = (
        UniqueConstraint("vehicle_id", "recorded_at"),
        Index("ix_positions_driver_time", "driver_id", "recorded_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), index=True)
    driver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    speed_kmh: Mapped[float] = mapped_column(Float, default=0)
    ignition: Mapped[bool] = mapped_column(Boolean, default=False)
    odometer_km: Mapped[float | None] = mapped_column(Float)
    # Gravada pelo rastreador simulado (opções de desenvolvedor), não por um rastreador de verdade
    simulated: Mapped[bool | None] = mapped_column(Boolean)
