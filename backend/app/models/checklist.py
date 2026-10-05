from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class VehicleChecklist(Base):
    """Checklist que o motorista faz antes de sair: cada item OK ou com problema (observação e foto)."""

    __tablename__ = "vehicle_checklists"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), index=True)
    run_id: Mapped[int | None] = mapped_column(ForeignKey("delivery_runs.id"), index=True)  # a rota que saiu depois dele
    odometer_km: Mapped[float | None] = mapped_column(Float)
    # [{"key": "brakes", "ok": false, "note": "...", "photo": "checklists/1/abc.jpg"}, ...]
    items: Mapped[list] = mapped_column(JSON, default=list)
    issues: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
