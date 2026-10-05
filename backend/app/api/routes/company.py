from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import AdminUser, CurrentUser, DbSession
from app.models import Company
from app.schemas.company import BaseLocation, GeocodeResult
from app.services import geocoding
from app.services.trips import company_base

router = APIRouter(prefix="/company", tags=["empresa"])


@router.get("/base", response_model=BaseLocation | None)
def get_base(db: DbSession, user: CurrentUser):
    """Base (CD) da empresa, ou nulo se ainda não foi definida."""
    return company_base(db.get(Company, user.company_id))


@router.put("/base", response_model=BaseLocation)
def set_base(data: BaseLocation, db: DbSession, admin: AdminUser):
    company = db.get(Company, admin.company_id)
    company.base_name = data.name.strip()
    company.base_address = (data.address or "").strip() or None
    company.base_latitude = data.latitude
    company.base_longitude = data.longitude
    company.base_radius_m = data.radius_m
    db.commit()
    return company_base(company)


@router.get("/geocode", response_model=list[GeocodeResult])
def geocode(admin: AdminUser, q: str = Query(min_length=3, max_length=200)):
    """Procura o endereço no OpenStreetMap (Nominatim). Uso leve: só quando o gestor busca a base."""
    try:
        rows = geocoding.search(q, limit=5)
    except geocoding.GeocodingError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Não consegui buscar o endereço agora. Marque o ponto clicando no mapa.")
    return [GeocodeResult(label=i["display_name"], latitude=float(i["lat"]), longitude=float(i["lon"])) for i in rows]
