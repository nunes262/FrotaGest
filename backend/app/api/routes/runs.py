from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, DbSession, DriverUser
from app.core.config import get_settings
from app.models import DeliveryRun, RunStatus, User, UserRole, Vehicle
from app.schemas.runs import PauseStart, RunHistory, RunOut, RunPointsIn, RunStart, RunSummary
from app.services import notify, payments, runs, simulator
from app.services.checklists import brief as run_checklist
from app.services.chat_hub import hub

router = APIRouter(prefix="/delivery-runs", tags=["rotas de entrega"])


def _get_run(db: Session, run_id: int, user: User) -> DeliveryRun:
    run = db.get(DeliveryRun, run_id)
    if not run or run.company_id != user.company_id or (user.role == UserRole.driver and run.driver_id != user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rota não encontrada.")
    return run


def _active_run(db: Session, run_id: int, driver: User) -> DeliveryRun:
    run = _get_run(db, run_id, driver)
    if run.status != RunStatus.active:
        raise HTTPException(status.HTTP_409_CONFLICT, "Essa rota já foi encerrada.")
    return run


def _notify_admins(background: BackgroundTasks, db: Session, company_id: int) -> None:
    """Avisa os gestores (tela de carregamento) que uma rota começou, mudou ou terminou."""
    background.add_task(hub.send_to_users, runs.admin_ids(db, company_id), {"type": "run_changed"})


@router.get("", response_model=list[RunSummary])
def list_runs(db: DbSession, user: CurrentUser, day: date | None = None):
    """Rotas do dia (hoje, se não informado). O motorista vê só as dele."""
    day = day or datetime.now(ZoneInfo(get_settings().timezone)).date()
    q = select(DeliveryRun).where(DeliveryRun.company_id == user.company_id, DeliveryRun.day == day)
    if user.role == UserRole.driver:
        q = q.where(DeliveryRun.driver_id == user.id)
    return [runs.run_summary(db, r) for r in db.scalars(q.order_by(DeliveryRun.started_at))]


@router.get("/history", response_model=list[RunHistory])
def run_history(
    db: DbSession, user: CurrentUser, date_from: date | None = None, date_to: date | None = None, driver_id: int | None = None,
):
    """Rotas feitas no período (sem datas, o mês atual), da mais recente para a mais antiga, com as entregas, as fotos
    e o valor. O motorista vê só as dele."""
    date_to = date_to or datetime.now(ZoneInfo(get_settings().timezone)).date()
    date_from = date_from or date_to.replace(day=1)
    if date_from > date_to or (date_to - date_from).days > 366:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Escolha um período de até 366 dias, com o fim depois do início.")
    return runs.history(db, user, date_from, date_to, driver_id)


@router.get("/current", response_model=RunOut | None)
def current_run(db: DbSession, driver: DriverUser):
    """Rota em andamento do motorista, ou nulo."""
    run = db.scalar(select(DeliveryRun).where(DeliveryRun.driver_id == driver.id, DeliveryRun.status == RunStatus.active))
    return runs.run_out(db, run) if run else None


@router.post("", response_model=RunOut, status_code=status.HTTP_201_CREATED)
def start_run(data: RunStart, db: DbSession, driver: DriverUser, background: BackgroundTasks):
    """Inicia a rota: localiza as entregas, calcula a melhor ordem pelas ruas (saindo da base e voltando a ela)
    e renumera as paradas nessa ordem. A partir daqui os km rodados entram na conta dos pneus."""
    run = runs.start_run(db, driver, data.day, data.checklist_id)
    _notify_admins(background, db, driver.company_id)
    checklist = run_checklist(db, run.id)
    if checklist and checklist.issues:
        vehicle = db.get(Vehicle, run.vehicle_id)
        data_ = {"run_id": run.id, "checklist_id": checklist.id, "issues": checklist.issues, "driver_name": driver.name, "plate": vehicle.plate}
        background.add_task(notify.send, [(runs.admin_ids(db, driver.company_id), {"type": "checklist_issues", "data": data_})])
    return runs.run_out(db, run)


@router.get("/{run_id}", response_model=RunOut)
def get_run(run_id: int, db: DbSession, user: CurrentUser):
    return runs.run_out(db, _get_run(db, run_id, user))


@router.post("/{run_id}/points")
def add_points(run_id: int, data: RunPointsIn, db: DbSession, driver: DriverUser):
    """Posições do GPS do celular durante a rota (usadas quando o veículo não manda posições pelo rastreador)."""
    return {"accepted": runs.add_points(db, _active_run(db, run_id, driver), data.points)}


@router.post("/{run_id}/replan", response_model=RunOut)
def replan_run(run_id: int, db: DbSession, driver: DriverUser, background: BackgroundTasks):
    """Recalcula a ordem com as entregas que faltam, a partir de onde o caminhão está."""
    run = runs.replan_run(db, _active_run(db, run_id, driver))
    _notify_admins(background, db, driver.company_id)
    return runs.run_out(db, run)


@router.post("/{run_id}/pauses", response_model=RunOut)
def start_pause(run_id: int, data: PauseStart, db: DbSession, driver: DriverUser, background: BackgroundTasks):
    """Pausa a rota: refeição, descanso ou espera de carga e descarga (Lei 13.103)."""
    run = runs.start_pause(db, _active_run(db, run_id, driver), data.kind)
    _notify_admins(background, db, driver.company_id)
    return runs.run_out(db, run)


@router.post("/{run_id}/pauses/end", response_model=RunOut)
def end_pause(run_id: int, db: DbSession, driver: DriverUser, background: BackgroundTasks):
    run = runs.end_pause(db, _active_run(db, run_id, driver))
    _notify_admins(background, db, driver.company_id)
    return runs.run_out(db, run)


@router.post("/{run_id}/finish", response_model=RunOut)
def finish_run(run_id: int, db: DbSession, driver: DriverUser, background: BackgroundTasks):
    """Encerra a rota. Com a tabela por região ligada, o preço da rota já entra como valor a receber."""
    run = runs.finish_run(db, _active_run(db, run_id, driver))
    _notify_admins(background, db, driver.company_id)
    if payment := payments.launch_for_run(db, run):
        background.add_task(simulator.send, payments.events(db, [payment], "created"))
    return runs.run_out(db, run)
