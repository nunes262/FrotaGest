import enum
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UserRole(str, enum.Enum):
    admin = "admin"
    driver = "driver"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    # Gestores entram com e-mail; motoristas com CPF.
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    cpf: Mapped[str | None] = mapped_column(String(11), unique=True)
    phone: Mapped[str | None] = mapped_column(String(20))
    # CNH do motorista; o vencimento aparece no cadastro para o gestor acompanhar
    cnh_number: Mapped[str | None] = mapped_column(String(11))
    cnh_category: Mapped[str | None] = mapped_column(String(2))
    cnh_expires_at: Mapped[date | None] = mapped_column(Date)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
