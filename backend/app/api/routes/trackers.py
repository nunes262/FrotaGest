from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import AdminUser, DbSession
from app.integrations import TrackerError, get_adapter
from app.models import Company, TrackerProvider, Vehicle
from app.schemas.trackers import LastPosition, TrackerCheckOut, TrackerConnectionIn, TrackerConnectionOut, TrackerVehicleOut
from app.workers.poller import store_positions

router = APIRouter(tags=["rastreadores"])

# Rastreadores com integração pronta (a Onixsat ainda depende do manual do fornecedor)
CONNECTABLE = ("sascar",)


def _connectable(provider: str) -> str:
    if provider not in CONNECTABLE:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Esse rastreador ainda não tem integração no FrotaGest.")
    return provider


def _connection(company: Company, provider: str, vehicles: list[TrackerVehicleOut] | None = None) -> TrackerConnectionOut:
    creds = (company.tracker_credentials or {}).get(provider) or {}
    return TrackerConnectionOut(provider=provider, configured=bool(creds.get("user")), user=creds.get("user"), vehicles=vehicles or [])


@router.get("/company/trackers", response_model=list[TrackerConnectionOut])
def list_trackers(db: DbSession, admin: AdminUser):
    company = db.get(Company, admin.company_id)
    return [_connection(company, p) for p in CONNECTABLE]


@router.put("/company/trackers/{provider}", response_model=TrackerConnectionOut)
def connect_tracker(provider: str, data: TrackerConnectionIn, db: DbSession, admin: AdminUser):
    """Testa o usuário e a senha no rastreador e só então salva. Devolve os veículos liberados para a integração,
    ligados aos veículos do FrotaGest pelo código no rastreador."""
    provider = _connectable(provider)
    creds = {"user": data.user.strip(), "password": data.password}
    try:
        found = get_adapter(provider, creds).list_vehicles()
    except TrackerError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{e} Nada foi salvo.")

    company = db.get(Company, admin.company_id)
    # O JSON precisa de um dicionário novo para o SQLAlchemy perceber a mudança
    company.tracker_credentials = {**(company.tracker_credentials or {}), provider: creds}
    db.commit()

    ours = {
        v.tracker_external_id: v
        for v in db.scalars(select(Vehicle).where(Vehicle.company_id == company.id, Vehicle.tracker_provider == TrackerProvider(provider)))
    }
    vehicles = [
        TrackerVehicleOut(
            external_id=t.external_id, plate=t.plate, description=t.description,
            vehicle_id=ours[t.external_id].id if t.external_id in ours else None,
            vehicle_plate=ours[t.external_id].plate if t.external_id in ours else None,
        )
        for t in found
    ]
    return _connection(company, provider, vehicles)


@router.delete("/company/trackers/{provider}", status_code=status.HTTP_204_NO_CONTENT)
def disconnect_tracker(provider: str, db: DbSession, admin: AdminUser):
    provider = _connectable(provider)
    company = db.get(Company, admin.company_id)
    company.tracker_credentials = {k: v for k, v in (company.tracker_credentials or {}).items() if k != provider}
    db.commit()


@router.post("/vehicles/{vehicle_id}/tracker-check", response_model=TrackerCheckOut)
def check_vehicle_tracker(vehicle_id: int, db: DbSession, admin: AdminUser):
    """Pergunta ao rastreador se o veículo está transmitindo (posições das últimas 24 h) e grava as que forem novas,
    para ele já aparecer no mapa."""
    vehicle = db.get(Vehicle, vehicle_id)
    if not vehicle or vehicle.company_id != admin.company_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Veículo não encontrado.")
    company = db.get(Company, admin.company_id)
    provider = vehicle.tracker_provider.value
    adapter = get_adapter(provider, (company.tracker_credentials or {}).get(provider))
    external_id = vehicle.tracker_external_id
    try:
        if adapter.is_vehicle_integrated(external_id) is False:
            return TrackerCheckOut(
                vehicle_id=vehicle.id, plate=vehicle.plate, external_id=external_id, status="not_integrated",
                positions_found=0, stored=0, last=None,
            )
        positions = adapter.recent_positions(external_id, hours=24)
    except TrackerError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except NotImplementedError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e) or "Esse rastreador ainda não tem integração no FrotaGest.")

    stored = store_positions(db, {external_id: vehicle}, positions)
    last = positions[-1] if positions else None
    return TrackerCheckOut(
        vehicle_id=vehicle.id, plate=vehicle.plate, external_id=external_id,
        status="transmitting" if last else "silent", positions_found=len(positions), stored=stored,
        last=LastPosition(
            recorded_at=last.recorded_at, latitude=last.latitude, longitude=last.longitude,
            speed_kmh=last.speed_kmh, ignition=last.ignition, address=last.address,
        ) if last else None,
    )
