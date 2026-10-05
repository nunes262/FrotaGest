from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import AdminUser, DbSession
from app.core.config import get_settings
from app.models import Company
from app.schemas.costs import CostSummary, FuelPriceIn, FuelPriceOut
from app.schemas.fleet import FuelType
from app.services import costs

router = APIRouter(prefix="/costs", tags=["custos"])


@router.get("/fuel-prices", response_model=list[FuelPriceOut])
def fuel_prices(db: DbSession, admin: AdminUser):
    """Preço do litro de diesel e gasolina. Na falta (ou se o da ANP tem mais de uma semana), busca na ANP."""
    return costs.price_list(costs.ensure_prices(db, db.get(Company, admin.company_id)))


@router.post("/fuel-prices/anp", response_model=list[FuelPriceOut])
def refresh_fuel_prices(db: DbSession, admin: AdminUser):
    """Troca os preços pelos da última pesquisa semanal da ANP (cidade da base ou média do estado)."""
    company = db.get(Company, admin.company_id)
    costs.refresh_from_anp(db, company)
    return costs.price_list(costs.ensure_prices(db, company))


@router.put("/fuel-prices/{fuel_type}", response_model=list[FuelPriceOut])
def set_fuel_price(fuel_type: FuelType, data: FuelPriceIn, db: DbSession, admin: AdminUser):
    """Preço informado pela empresa (o que ela paga no posto conveniado, por exemplo)."""
    costs.set_manual(db, admin.company_id, fuel_type, data.price_per_liter)
    return costs.price_list(costs.ensure_prices(db, db.get(Company, admin.company_id)))


@router.get("/summary", response_model=CostSummary)
def cost_summary(
    db: DbSession,
    admin: AdminUser,
    date_from: date | None = None,
    date_to: date | None = None,
    fuel_type: FuelType | None = Query(default=None, description="Só os veículos a diesel ou a gasolina"),
):
    """Custo por veículo no período (padrão: mês atual), sobre os km rodados nas rotas."""
    today = datetime.now(ZoneInfo(get_settings().timezone)).date()
    date_to = date_to or today
    date_from = date_from or date_to.replace(day=1)
    if date_from > date_to or date_to - date_from > timedelta(days=366):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Escolha um período de até um ano, com a data inicial antes da final.")
    return costs.cost_summary(db, db.get(Company, admin.company_id), date_from, date_to, fuel_type)
