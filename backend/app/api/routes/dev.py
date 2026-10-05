"""Opções de desenvolvedor: rastreador simulado para testar o fluxo de entrega sem sair com o caminhão."""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, DbSession
from app.core.config import get_settings
from app.models import TrackerSimulation, User, UserRole, Vehicle
from app.schemas.dev import SimulationIn, SimulationOut, SimulationReset
from app.services import simulator


def _dev_tools_on() -> None:
    if not get_settings().dev_tools:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Opções de desenvolvedor desligadas neste servidor (DEV_TOOLS=false).")


router = APIRouter(prefix="/dev", tags=["opções de desenvolvedor"], dependencies=[Depends(_dev_tools_on)])


def _vehicle(db: Session, vehicle_id: int, user: User) -> Vehicle:
    """Gestor: qualquer veículo da empresa. Motorista: só o dele."""
    vehicle = db.get(Vehicle, vehicle_id)
    if not vehicle or vehicle.company_id != user.company_id or (
        user.role == UserRole.driver and vehicle.current_driver_id != user.id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Veículo não encontrado.")
    return vehicle


def _simulation(db: Session, vehicle_id: int, user: User) -> TrackerSimulation:
    vehicle = _vehicle(db, vehicle_id, user)
    sim = db.get(TrackerSimulation, vehicle.id)
    if not sim:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "O rastreador simulado está desligado nesse veículo.")
    return sim


def _changed(background: BackgroundTasks, db: Session, vehicle: Vehicle, events: simulator.Events | None = None) -> None:
    """Avisa o gestor e o motorista: a tela de opções, o mapa e a rota atualizam na hora."""
    events = events or simulator.Events()
    to = simulator.recipients(db, vehicle)
    events.add(to, {"type": "simulation", "vehicle_id": vehicle.id})
    events.add(to, {"type": "positions", "vehicle_id": vehicle.id})
    background.add_task(simulator.send, events.items)


@router.get("/simulations", response_model=list[SimulationOut])
def list_simulations(db: DbSession, user: CurrentUser):
    """Rastreadores simulados ligados. O motorista vê só o do veículo dele."""
    q = select(TrackerSimulation).join(Vehicle, Vehicle.id == TrackerSimulation.vehicle_id).where(
        Vehicle.company_id == user.company_id
    )
    if user.role == UserRole.driver:
        q = q.where(Vehicle.current_driver_id == user.id)
    return [simulator.describe(db, s) for s in db.scalars(q.order_by(Vehicle.plate))]


@router.put("/simulations/{vehicle_id}", response_model=SimulationOut)
def set_simulation(vehicle_id: int, data: SimulationIn, db: DbSession, user: CurrentUser, background: BackgroundTasks):
    """Liga o rastreador simulado no veículo (ou muda os ajustes). Daí em diante as posições dele vêm da simulação:
    na base enquanto não há rota e seguindo o traçado quando o motorista inicia a rota."""
    vehicle = _vehicle(db, vehicle_id, user)
    with simulator.lock:
        sim = db.get(TrackerSimulation, vehicle.id) or simulator.start(db, vehicle)
        for field, value in data.model_dump(exclude_none=True).items():
            setattr(sim, field, value)
        db.commit()
    _changed(background, db, vehicle)
    return simulator.describe(db, sim)


@router.delete("/simulations/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
def stop_simulation(vehicle_id: int, db: DbSession, user: CurrentUser, background: BackgroundTasks):
    """Desliga a simulação. As posições já gravadas continuam no histórico."""
    sim = _simulation(db, vehicle_id, user)
    vehicle = db.get(Vehicle, sim.vehicle_id)
    with simulator.lock:
        db.delete(sim)
        db.commit()
    _changed(background, db, vehicle)


@router.post("/simulations/{vehicle_id}/skip", response_model=SimulationOut)
def skip_to_next_stop(vehicle_id: int, db: DbSession, user: CurrentUser, background: BackgroundTasks):
    """Leva o veículo direto até a próxima entrega (ou até a base), somando os km do caminho."""
    sim = _simulation(db, vehicle_id, user)
    events = simulator.Events()
    with simulator.lock:
        simulator.skip(db, sim, events)
        db.commit()
    _changed(background, db, db.get(Vehicle, sim.vehicle_id), events)
    return simulator.describe(db, sim)


@router.post("/simulations/{vehicle_id}/reset", response_model=SimulationReset)
def reset_test(vehicle_id: int, db: DbSession, user: CurrentUser, background: BackgroundTasks):
    """Recomeça o teste de hoje: apaga as rotas do dia do veículo e as posições simuladas e devolve as entregas
    resolvidas hoje para o caminhão do motorista, sem os comprovantes."""
    sim = _simulation(db, vehicle_id, user)
    vehicle = db.get(Vehicle, sim.vehicle_id)
    with simulator.lock:
        counts = simulator.reset(db, sim)
        db.commit()
    events = simulator.Events()
    to = simulator.recipients(db, vehicle)
    events.add(to, {"type": "run_changed"})
    events.add(to, {"type": "deliveries_changed"})
    _changed(background, db, vehicle, events)
    return SimulationReset(**counts)
