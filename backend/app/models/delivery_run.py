import enum
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Enum, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RunStatus(str, enum.Enum):
    active = "active"
    finished = "finished"


class DeliveryRun(Base):
    """Rota de entrega iniciada pelo motorista: a ordem otimizada das paradas e os km rodados do início ao fim."""

    __tablename__ = "delivery_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), index=True)
    day: Mapped[date] = mapped_column(Date)
    status: Mapped[RunStatus] = mapped_column(Enum(RunStatus), default=RunStatus.active)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Ponto de partida da rota planejada (a base, ou onde o caminhão estava ao recalcular)
    origin_latitude: Mapped[float | None] = mapped_column(Float)
    origin_longitude: Mapped[float | None] = mapped_column(Float)
    returns_to_base: Mapped[bool] = mapped_column(Boolean, default=False)
    planned_distance_km: Mapped[float | None] = mapped_column(Float)
    planned_duration_min: Mapped[int | None] = mapped_column(Integer)
    # False quando o serviço de navegação falhou e a ordem foi aproximada pela distância em linha reta
    optimized: Mapped[bool] = mapped_column(Boolean, default=False)
    # Traçado da rota planejada pelas ruas: [[lat, lon], ...]
    geometry: Mapped[list] = mapped_column(JSON, default=list)
    # Paradas na ordem planejada e a distância de cada trecho: [{"delivery_id": 1, "leg_km": 12.3}, ...]
    plan: Mapped[list] = mapped_column(JSON, default=list)
    # Km rodados, gravados ao encerrar (enquanto a rota está ativa, são calculados na hora)
    distance_km: Mapped[float | None] = mapped_column(Float)
    km_source: Mapped[str | None] = mapped_column(String(10))  # "tracker" ou "phone"
    # Peso carregado nesta rota (as entregas que saíram com ela e as que entraram ao recalcular), em kg
    load_kg: Mapped[float | None] = mapped_column(Float)
    # Região de preço da rota e o preço dela quando a rota foi calculada (mudar a tabela não muda rotas já feitas)
    region_name: Mapped[str | None] = mapped_column(String(80))
    region_price_cents: Mapped[int | None] = mapped_column(Integer)
    # Valor a pagar ao motorista por esta rota (sozinha ou junto com outras)
    payment_id: Mapped[int | None] = mapped_column(ForeignKey("driver_payments.id"))


class RunPoint(Base):
    """Posição enviada pelo celular do motorista durante a rota (usada quando o veículo não tem rastreador)."""

    __tablename__ = "delivery_run_points"
    __table_args__ = (UniqueConstraint("run_id", "recorded_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("delivery_runs.id"), index=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    accuracy_m: Mapped[float | None] = mapped_column(Float)

    @property
    def odometer_km(self) -> None:
        return None  # o celular não tem hodômetro: route_distance_km soma os trechos


class RunPause(Base):
    """Pausa durante a rota (Lei 13.103): refeição (mínimo de 1 h), descanso ou espera de carga e descarga."""

    __tablename__ = "delivery_run_pauses"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("delivery_runs.id"), index=True)
    kind: Mapped[str] = mapped_column(String(10))  # "meal", "rest" ou "wait"
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
