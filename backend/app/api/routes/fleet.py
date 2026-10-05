from fastapi import APIRouter, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import AdminUser, CurrentUser, DbSession
from app.core.security import hash_password
from app.models import (
    Conversation,
    ConversationKind,
    ConversationMember,
    Delivery,
    DeliveryRun,
    DeliveryStatus,
    RunStatus,
    Tire,
    User,
    UserRole,
    Vehicle,
)
from app.schemas.fleet import (
    DriverCreate,
    DriverOut,
    DriverPurge,
    DriverReactivate,
    DriverRemoval,
    VehicleCreate,
    VehicleDeletion,
    VehicleOut,
    VehicleUpdate,
    VehicleUsage,
)
from app.schemas.tires import POSITIONS_BY_LAYOUT
from app.services import drivers, runs, vehicles
from app.services.chat_hub import hub
from app.services.documents import is_valid_cpf, is_valid_plate, normalize_plate

router = APIRouter(tags=["frota"])


def _checked_plate(plate: str) -> str:
    plate = normalize_plate(plate)
    if not is_valid_plate(plate):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Placa inválida. Use o formato ABC1D23 ou ABC1234.")
    return plate


def _assign_driver(db: Session, vehicle: Vehicle, driver_id: int | None, company_id: int) -> None:
    """Coloca o veículo com o motorista (ou sem ninguém, com None). Cada motorista fica com um veículo só:
    se ele estava com outro, esse outro fica livre."""
    if driver_id is not None:
        driver = db.get(User, driver_id)
        if not driver or driver.company_id != company_id or driver.role != UserRole.driver or not driver.active:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Motorista não encontrado.")
        for other in db.scalars(select(Vehicle).where(Vehicle.current_driver_id == driver_id, Vehicle.id != vehicle.id)):
            other.current_driver_id = None
    vehicle.current_driver_id = driver_id


@router.get("/vehicles", response_model=list[VehicleOut])
def list_vehicles(db: DbSession, user: CurrentUser):
    q = select(Vehicle).where(Vehicle.company_id == user.company_id).order_by(Vehicle.plate)
    if user.role == UserRole.driver:
        q = q.where(Vehicle.current_driver_id == user.id)
    return db.scalars(q).all()


@router.post("/vehicles", response_model=VehicleOut, status_code=status.HTTP_201_CREATED)
def create_vehicle(data: VehicleCreate, db: DbSession, user: CurrentUser):
    """O gestor cadastra qualquer veículo. O motorista sem veículo cadastra o dele, que já fica no seu nome."""
    duplicate = "Já existe um veículo com essa placa."
    if user.role == UserRole.driver:
        if db.scalar(select(Vehicle.id).where(Vehicle.current_driver_id == user.id)):
            raise HTTPException(status.HTTP_409_CONFLICT, "Você já tem um veículo. Complete os dados dele em vez de cadastrar outro.")
        data = data.model_copy(update={"current_driver_id": user.id})
        duplicate += " Peça para a base colocar esse veículo no seu nome."
    vehicle = Vehicle(company_id=user.company_id, **data.model_dump(exclude={"current_driver_id"}))
    vehicle.plate = _checked_plate(data.plate)
    vehicle.model = (data.model or "").strip() or None
    vehicle.tracker_external_id = data.tracker_external_id.strip()
    _assign_driver(db, vehicle, data.current_driver_id, user.company_id)
    db.add(vehicle)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, duplicate)
    return vehicle


REQUIRED_VEHICLE_FIELDS = {"plate", "tracker_provider", "tracker_external_id"}


@router.patch("/vehicles/{vehicle_id}", response_model=VehicleOut)
def update_vehicle(vehicle_id: int, data: VehicleUpdate, db: DbSession, user: CurrentUser):
    """O gestor altera qualquer dado e troca o motorista. O motorista só completa o próprio veículo:
    preenche o que está em branco, sem mudar o que a base já cadastrou."""
    vehicle = db.get(Vehicle, vehicle_id)
    is_driver = user.role == UserRole.driver
    if not vehicle or vehicle.company_id != user.company_id or (is_driver and vehicle.current_driver_id != user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Veículo não encontrado.")

    changes = data.model_dump(exclude_unset=True)
    new_driver = changes.pop("current_driver_id", vehicle.current_driver_id)
    if is_driver and new_driver != vehicle.current_driver_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Só a base troca o motorista do veículo.")
    if "plate" in changes and changes["plate"] is not None:
        changes["plate"] = _checked_plate(changes["plate"])
    for field in ("model", "tracker_external_id"):
        if isinstance(changes.get(field), str):
            changes[field] = changes[field].strip() or None
    if any(changes[f] is None for f in REQUIRED_VEHICLE_FIELDS & changes.keys()):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Placa, rastreador e código no rastreador não podem ficar em branco.")
    if is_driver and any(getattr(vehicle, f) not in (None, "") and getattr(vehicle, f) != v for f, v in changes.items()):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Você só pode preencher o que está em branco. Para corrigir um dado já cadastrado, fale com a base."
        )

    if "axle_layout" in changes and (changes["axle_layout"] or "dual") != (vehicle.axle_layout or "dual"):
        allowed = POSITIONS_BY_LAYOUT[changes["axle_layout"] or "dual"]
        stranded = db.scalars(select(Tire.position).where(Tire.vehicle_id == vehicle.id, Tire.position.not_in(allowed))).all()
        if stranded:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Há pneus em posições que não existem nesse rodado ({', '.join(stranded)}). Mude-os de posição ou remova antes.",
            )
    for field, value in changes.items():
        setattr(vehicle, field, value)
    if new_driver != vehicle.current_driver_id:
        _assign_driver(db, vehicle, new_driver, user.company_id)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe um veículo com essa placa.")
    return vehicle


def _company_vehicle(db: Session, vehicle_id: int, admin: User) -> Vehicle:
    vehicle = db.get(Vehicle, vehicle_id)
    if not vehicle or vehicle.company_id != admin.company_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Veículo não encontrado.")
    return vehicle


@router.get("/vehicles/{vehicle_id}/usage", response_model=VehicleUsage)
def vehicle_usage(vehicle_id: int, db: DbSession, admin: AdminUser):
    """O que seria apagado junto com o veículo (para a confirmação)."""
    return vehicles.usage(db, _company_vehicle(db, vehicle_id, admin))


@router.delete("/vehicles/{vehicle_id}", response_model=VehicleDeletion)
async def delete_vehicle(vehicle_id: int, db: DbSession, admin: AdminUser):
    """Exclui o veículo com as posições do rastreador, as rotas feitas com ele e os pneus (não dá para desfazer).
    Se tinha motorista, ele fica sem veículo."""
    result = vehicles.delete_vehicle(db, _company_vehicle(db, vehicle_id, admin))
    await hub.send_to_users(runs.admin_ids(db, admin.company_id), {"type": "run_changed"})
    return result


@router.get("/drivers", response_model=list[DriverOut])
def list_drivers(db: DbSession, admin: AdminUser):
    q = select(User).where(User.company_id == admin.company_id, User.role == UserRole.driver).order_by(User.name)
    return db.scalars(q).all()


@router.post("/drivers", response_model=DriverOut, status_code=status.HTTP_201_CREATED)
def create_driver(data: DriverCreate, db: DbSession, admin: AdminUser):
    """Cadastra o motorista e, se informado, já entrega um veículo para ele."""
    if not is_valid_cpf(data.cpf):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "CPF inválido. Confira os números.")
    if data.vehicle_id and data.new_vehicle:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Escolha um veículo já cadastrado ou cadastre um novo, não os dois.")
    existing = db.scalar(select(User).where(User.cpf == data.cpf))
    if existing and not existing.active and existing.company_id == admin.company_id:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Esse CPF é de {existing.name}, que foi removido. Use “Reativar” em Motoristas removidos."
        )
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe um usuário com esse CPF.")

    vehicle = None
    if data.vehicle_id:
        vehicle = db.get(Vehicle, data.vehicle_id)
        if not vehicle or vehicle.company_id != admin.company_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Veículo não encontrado.")
    elif data.new_vehicle:
        plate = _checked_plate(data.new_vehicle.plate)
        if db.scalar(select(Vehicle.id).where(Vehicle.company_id == admin.company_id, Vehicle.plate == plate)):
            raise HTTPException(status.HTTP_409_CONFLICT, "Já existe um veículo com essa placa.")
        vehicle = Vehicle(company_id=admin.company_id, **data.new_vehicle.model_dump(exclude={"plate"}), plate=plate)
        db.add(vehicle)

    driver = User(
        company_id=admin.company_id,
        name=data.name.strip(),
        password_hash=hash_password(data.password),
        role=UserRole.driver,
        **data.model_dump(include={"cpf", "phone", "cnh_number", "cnh_category", "cnh_expires_at"}),
    )
    db.add(driver)
    try:
        db.flush()
        if vehicle:
            # Um veículo que já tinha motorista passa para este
            vehicle.current_driver_id = driver.id
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe um usuário com esse CPF ou um veículo com essa placa.")
    return driver


def _company_driver(db: Session, driver_id: int, admin: User) -> User:
    driver = db.get(User, driver_id)
    if not driver or driver.company_id != admin.company_id or driver.role != UserRole.driver:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Motorista não encontrado.")
    return driver


@router.delete("/drivers/{driver_id}", response_model=DriverRemoval)
async def remove_driver(driver_id: int, db: DbSession, admin: AdminUser):
    """Remove o motorista (demissão, por exemplo): ele perde o acesso ao app na hora, o veículo fica livre,
    as entregas que faltavam voltam para a fila, a rota em andamento é encerrada e ele sai dos grupos do chat.
    O histórico (rotas, km, comprovantes e conversas) fica guardado: a Lei 13.103 exige comprovar a jornada."""
    driver = _company_driver(db, driver_id, admin)
    if not driver.active:
        raise HTTPException(status.HTTP_409_CONFLICT, "Esse motorista já foi removido.")

    run = db.scalar(select(DeliveryRun).where(DeliveryRun.driver_id == driver.id, DeliveryRun.status == RunStatus.active))
    if run:
        runs.finish_run(db, run)
    vehicles = db.scalars(select(Vehicle).where(Vehicle.current_driver_id == driver.id)).all()
    for v in vehicles:
        v.current_driver_id = None
    # As entregues ficam com ele (histórico); as que faltavam ou não foram recebidas voltam para a fila
    returned = db.scalars(
        select(Delivery).where(
            Delivery.driver_id == driver.id, Delivery.status.in_([DeliveryStatus.assigned, DeliveryStatus.failed])
        )
    ).all()
    for d in returned:
        d.driver_id, d.stop_order, d.status = None, None, DeliveryStatus.pending
    groups = select(Conversation.id).where(Conversation.kind == ConversationKind.group)
    db.execute(delete(ConversationMember).where(ConversationMember.user_id == driver.id, ConversationMember.conversation_id.in_(groups)))
    driver.active = False
    db.commit()

    await hub.close_user(driver.id)
    admins = runs.admin_ids(db, admin.company_id)
    await hub.send_to_users(admins, {"type": "deliveries_changed"})
    await hub.send_to_users(admins, {"type": "conversation", "data": {}})
    return DriverRemoval(
        driver=DriverOut.model_validate(driver),
        released_vehicles=[v.plate for v in vehicles],
        returned_deliveries=len(returned),
        finished_run=run is not None,
    )


@router.delete("/drivers/{driver_id}/permanent", response_model=DriverPurge)
async def purge_driver(driver_id: int, db: DbSession, admin: AdminUser):
    """Exclui de vez um motorista já removido, com tudo o que é dele (não dá para desfazer).
    Atenção: sem esse histórico a empresa não consegue comprovar a jornada dele (Lei 13.103)."""
    driver = _company_driver(db, driver_id, admin)
    if driver.active:
        raise HTTPException(status.HTTP_409_CONFLICT, "Remova o motorista antes de excluir de vez.")
    result = drivers.purge_driver(db, driver)
    admins = runs.admin_ids(db, admin.company_id)
    await hub.send_to_users(admins, {"type": "conversation", "data": {}})
    await hub.send_to_users(admins, {"type": "run_changed"})
    return result


@router.post("/drivers/{driver_id}/reactivate", response_model=DriverOut)
def reactivate_driver(driver_id: int, data: DriverReactivate, db: DbSession, admin: AdminUser):
    """Volta o acesso de um motorista removido (recontratação), com um veículo livre e uma senha nova se quiser."""
    driver = _company_driver(db, driver_id, admin)
    if driver.active:
        raise HTTPException(status.HTTP_409_CONFLICT, "Esse motorista já está ativo.")
    if data.vehicle_id:
        vehicle = db.get(Vehicle, data.vehicle_id)
        if not vehicle or vehicle.company_id != admin.company_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Veículo não encontrado.")
        if vehicle.current_driver_id:
            raise HTTPException(status.HTTP_409_CONFLICT, "Esse veículo já está com outro motorista.")
        vehicle.current_driver_id = driver.id
    if data.password:
        driver.password_hash = hash_password(data.password)
    driver.active = True
    db.commit()
    return driver
