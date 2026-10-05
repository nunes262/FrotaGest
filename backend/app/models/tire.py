from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

SPARE_POSITION = "ESTEPE"
# Profundidade mínima permitida (Resolução CONTRAN 913/2022): é o 0% da banda
LEGAL_MIN_TREAD_MM = 1.6


class Tire(Base):
    """Pneu montado num veículo. O desgaste é estimado pelos km rodados nas rotas desde a última medição."""

    __tablename__ = "tires"
    __table_args__ = (UniqueConstraint("vehicle_id", "position"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), index=True)
    # Código da posição: E1E (1º eixo, esquerdo), E2EE (2º eixo, esquerdo externo)... ou ESTEPE
    position: Mapped[str] = mapped_column(String(8))
    brand: Mapped[str | None] = mapped_column(String(120))
    # Número de fogo ou outra marcação do pneu
    identification: Mapped[str | None] = mapped_column(String(40))
    # Km que o pneu roda de 100% até 0% (vida útil da banda)
    life_km: Mapped[int] = mapped_column(Integer)
    # Última medição: quanto da banda restava e quantos km o veículo tinha rodado em rotas naquele momento
    measured_pct: Mapped[float] = mapped_column(Float)
    measured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    km_at_measure: Mapped[float] = mapped_column(Float, default=0)
    # Preço pago (entra no custo por km), recapagens feitas e km do veículo quando o pneu foi montado
    cost: Mapped[float | None] = mapped_column(Float)
    retreads: Mapped[int | None] = mapped_column(Integer, default=0)
    km_at_mount: Mapped[float | None] = mapped_column(Float)
    # Profundidade do sulco do pneu novo, em mm (permite medir em mm; 0% de banda = 1,6 mm, o mínimo legal)
    tread_new_mm: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TireEvent(Base):
    """Histórico do pneu: montagem, medição, rodízio e recapagem, com o custo quando houver."""

    __tablename__ = "tire_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    tire_id: Mapped[int] = mapped_column(ForeignKey("tires.id", ondelete="CASCADE"), index=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    kind: Mapped[str] = mapped_column(String(10))  # "mount", "measure", "rotation" ou "retread"
    happened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    vehicle_km: Mapped[float] = mapped_column(Float)  # km do veículo em rotas naquele momento
    measured_pct: Mapped[float | None] = mapped_column(Float)
    cost: Mapped[float | None] = mapped_column(Float)
    detail: Mapped[str | None] = mapped_column(String(120))  # ex.: "E2DI → E2EE"
