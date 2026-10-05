from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Company(Base):
    """Cada transportadora/distribuidora cliente é uma empresa isolada (multiempresa)."""

    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    cnpj: Mapped[str | None] = mapped_column(String(18), unique=True)
    # Credenciais de integração por provedor, ex.: {"sascar": {"user": "...", "password": "..."}}
    # Em produção, guarde isso criptografado ou num cofre de segredos.
    tracker_credentials: Mapped[dict] = mapped_column(JSON, default=dict)
    # Base (CD) de onde os caminhões saem: a viagem começa ao sair desse raio e termina ao voltar
    base_name: Mapped[str | None] = mapped_column(String(120))
    base_address: Mapped[str | None] = mapped_column(String(255))
    base_latitude: Mapped[float | None] = mapped_column(Float)
    base_longitude: Mapped[float | None] = mapped_column(Float)
    base_radius_m: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
