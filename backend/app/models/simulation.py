from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TrackerSimulation(Base):
    """Rastreador simulado (opções de desenvolvedor): anda com o veículo pela rota em andamento como se fosse
    o rastreador de verdade, para testar o fluxo do motorista e do gestor sem sair com o caminhão."""

    __tablename__ = "tracker_simulations"

    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    # Quantas vezes mais rápido que o tempo real (1 = tempo real)
    speed_factor: Mapped[float] = mapped_column(Float, default=10)
    # Velocidade média do caminhão nas ruas (km/h)
    cruise_kmh: Mapped[float] = mapped_column(Float, default=40)
    # Tempo parado em cada entrega, em minutos do tempo simulado
    dwell_min: Mapped[float] = mapped_column(Float, default=3)
    # Motorista automático: confirma as entregas sozinho e encerra a rota ao voltar para a base
    auto_driver: Mapped[bool] = mapped_column(Boolean, default=False)
    paused: Mapped[bool] = mapped_column(Boolean, default=False)

    # Estado: "idle" (sem rota), "driving", "at_stop", "returning" (indo para a base) ou "at_base"
    phase: Mapped[str] = mapped_column(String(12), default="idle")
    run_id: Mapped[int | None] = mapped_column(Integer)
    plan_key: Mapped[str | None] = mapped_column(String(64))  # muda quando a rota é recalculada
    progress_m: Mapped[float] = mapped_column(Float, default=0)  # metros andados no traçado da rota
    odometer_km: Mapped[float] = mapped_column(Float, default=0)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    stop_delivery_id: Mapped[int | None] = mapped_column(Integer)  # entrega onde está parado
    stopped_s: Mapped[float] = mapped_column(Float, default=0)  # segundos simulados parado ali
    last_tick_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_position_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
