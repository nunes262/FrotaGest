from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RouteRegion(Base):
    """Região de preço: toda rota que atende a região vale o mesmo preço fixo, não importa quantas entregas leve.

    Uma entrega cai na região que lista a cidade dela; se nenhuma lista, na primeira faixa de distância da base que a
    cobre (max_km nulo = sem limite). A rota vale o preço da região mais cara entre as entregas."""

    __tablename__ = "route_regions"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    price_cents: Mapped[int] = mapped_column(Integer)
    max_km: Mapped[float | None] = mapped_column(Float)  # distância em linha reta da base
    cities: Mapped[list] = mapped_column(JSON, default=list)  # nomes como o gestor digitou
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
