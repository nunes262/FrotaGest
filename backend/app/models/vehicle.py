import enum

from sqlalchemy import Enum, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TrackerProvider(str, enum.Enum):
    mock = "mock"
    sascar = "sascar"
    onixsat = "onixsat"


class Vehicle(Base):
    __tablename__ = "vehicles"
    __table_args__ = (UniqueConstraint("company_id", "plate"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    plate: Mapped[str] = mapped_column(String(8))
    model: Mapped[str | None] = mapped_column(String(120))
    # Carga útil, usada para conferir o peso no carregamento
    capacity_kg: Mapped[int | None] = mapped_column(Integer)
    tracker_provider: Mapped[TrackerProvider] = mapped_column(Enum(TrackerProvider))
    # Identificador do veículo no sistema do rastreador
    tracker_external_id: Mapped[str] = mapped_column(String(64))
    current_driver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    # Para o custo por km: "diesel" (S10) ou "gasolina" (comum) e o consumo médio em km por litro
    fuel_type: Mapped[str | None] = mapped_column(String(10))
    km_per_liter: Mapped[float | None] = mapped_column(Float)
    # Rodado traseiro: "single" (simples, 4 pneus, como vans) ou "dual" (duplo, com pneus internos). Vazio = duplo
    axle_layout: Mapped[str | None] = mapped_column(String(6))
    # Km de rotas de motoristas excluídos de vez: as rotas somem, mas o veículo rodou (conta no desgaste dos pneus)
    archived_route_km: Mapped[float | None] = mapped_column(Float)
