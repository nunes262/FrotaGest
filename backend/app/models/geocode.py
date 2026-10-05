from datetime import datetime

from sqlalchemy import DateTime, Float, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class GeocodedAddress(Base):
    """Cache do geocodificador (o Nominatim só permite uso leve). Endereço não encontrado também fica guardado."""

    __tablename__ = "geocoded_addresses"

    id: Mapped[int] = mapped_column(primary_key=True)
    query: Mapped[str] = mapped_column(String(400), unique=True)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    # "address" (o número), "street" (só a rua) ou "city" (centro da cidade); nulo se não achou
    precision: Mapped[str | None] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
