from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import AdminUser, CurrentUser, DbSession
from app.core.config import get_settings
from app.models import Company, Delivery, DeliveryStatus, RouteRegion, UserRole
from app.schemas.regions import RegionEstimate, RegionOut, RegionTable, RegionTableIn
from app.services import regions
from app.services.trips import company_base

router = APIRouter(prefix="/route-regions", tags=["preço por região"])


def _out(company: Company, rows: list[RouteRegion]) -> RegionTable:
    return RegionTable(
        regions=[RegionOut(id=r.id, name=r.name, price=r.price_cents / 100, max_km=r.max_km, cities=r.cities or []) for r in rows],
        has_base=company_base(company) is not None,
    )


@router.get("", response_model=RegionTable)
def get_table(db: DbSession, user: CurrentUser):
    """Tabela de preço fixo por região (na primeira vez, a sugerida). O motorista também vê, para saber quanto vale cada rota."""
    company = db.get(Company, user.company_id)
    rows = regions.table(db, company)
    db.commit()
    return _out(company, rows)


@router.put("", response_model=RegionTable)
def save_table(data: RegionTableIn, db: DbSession, admin: AdminUser):
    """Troca a tabela inteira. Rotas já calculadas continuam com o preço que tinham."""
    regions.validate(data.regions)
    company = db.get(Company, admin.company_id)
    for row in db.scalars(select(RouteRegion).where(RouteRegion.company_id == company.id)):
        db.delete(row)
    db.flush()
    rows = [
        RouteRegion(
            company_id=company.id, name=r.name.strip(), price_cents=round(r.price * 100), max_km=r.max_km,
            cities=list(dict.fromkeys(c.strip() for c in r.cities if c.strip())),
        )
        for r in data.regions
    ]
    db.add_all(rows)
    db.commit()
    return _out(company, regions.table(db, company))


@router.post("/reset", response_model=RegionTable)
def reset_table(db: DbSession, admin: AdminUser):
    """Volta para a tabela sugerida."""
    company = db.get(Company, admin.company_id)
    rows = regions.reset(db, company)
    db.commit()
    return _out(company, rows)


@router.get("/estimate", response_model=list[RegionEstimate])
def estimate(db: DbSession, user: CurrentUser, day: date | None = None):
    """Região e preço previstos do que está em cada caminhão no dia, antes de a rota começar."""
    day = day or datetime.now(ZoneInfo(get_settings().timezone)).date()
    company = db.get(Company, user.company_id)
    q = select(Delivery).where(
        Delivery.company_id == user.company_id, Delivery.scheduled_for == day,
        Delivery.status == DeliveryStatus.assigned, Delivery.driver_id.is_not(None),
    )
    if user.role == UserRole.driver:
        q = q.where(Delivery.driver_id == user.id)
    by_driver: dict[int, list[Delivery]] = {}
    for d in db.scalars(q):
        by_driver.setdefault(d.driver_id, []).append(d)
    out = []
    for driver_id, items in by_driver.items():
        region, unplaced = regions.estimate(db, company, items)
        out.append(RegionEstimate(
            driver_id=driver_id, region_name=region.name if region else None,
            price=region.price_cents / 100 if region else None, unplaced=unplaced,
        ))
    db.commit()  # a tabela sugerida pode ter sido criada agora
    return out
