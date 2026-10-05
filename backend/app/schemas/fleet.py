from datetime import date
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from app.models import TrackerProvider

CnhCategory = Literal["A", "B", "C", "D", "E", "AB", "AC", "AD", "AE"]
FuelType = Literal["diesel", "gasolina"]
AxleLayout = Literal["single", "dual"]


class VehicleBase(BaseModel):
    plate: str = Field(min_length=7, max_length=8)
    model: str | None = None
    capacity_kg: int | None = Field(default=None, gt=0)
    tracker_provider: TrackerProvider
    tracker_external_id: str = Field(min_length=1)
    fuel_type: FuelType | None = None
    km_per_liter: float | None = Field(default=None, gt=0, le=50, description="Consumo médio")
    axle_layout: AxleLayout | None = Field(default=None, description="Rodado traseiro: simples (4 pneus) ou duplo")


class VehicleCreate(VehicleBase):
    current_driver_id: int | None = None


class VehicleUpdate(BaseModel):
    """Só os campos enviados mudam. O motorista só pode preencher o que ainda está em branco."""

    plate: str | None = Field(default=None, min_length=7, max_length=8)
    model: str | None = None
    capacity_kg: int | None = Field(default=None, gt=0)
    tracker_provider: TrackerProvider | None = None
    tracker_external_id: str | None = Field(default=None, min_length=1)
    fuel_type: FuelType | None = None
    km_per_liter: float | None = Field(default=None, gt=0, le=50)
    axle_layout: AxleLayout | None = None
    # Só o gestor troca o motorista do veículo; nulo deixa o veículo sem motorista
    current_driver_id: int | None = None


class VehicleOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    plate: str
    model: str | None
    capacity_kg: int | None
    tracker_provider: TrackerProvider
    tracker_external_id: str
    current_driver_id: int | None
    fuel_type: FuelType | None
    km_per_liter: float | None
    axle_layout: AxleLayout | None


class DriverCreate(BaseModel):
    name: str = Field(min_length=3, max_length=160)
    cpf: str = Field(pattern=r"^\d{11}$", description="Somente números")
    phone: str | None = Field(default=None, max_length=20)
    cnh_number: str | None = Field(default=None, pattern=r"^\d{11}$")
    cnh_category: CnhCategory | None = None
    cnh_expires_at: date | None = None
    password: str = Field(min_length=6)
    # Veículo do motorista (opcional): um já cadastrado ou um novo
    vehicle_id: int | None = None
    new_vehicle: VehicleBase | None = None


class DriverOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    cpf: str | None
    phone: str | None
    cnh_number: str | None
    cnh_category: str | None
    cnh_expires_at: date | None
    active: bool


class DriverRemoval(BaseModel):
    """O que aconteceu ao remover o motorista."""

    driver: DriverOut
    released_vehicles: list[str]  # placas que ficaram sem motorista
    returned_deliveries: int  # entregas que voltaram para a fila de carregamento
    finished_run: bool  # tinha uma rota em andamento, que foi encerrada


class VehicleUsage(BaseModel):
    """O que vai junto se o veículo for excluído."""

    driver_name: str | None
    positions: int  # do rastreador
    runs: int  # rotas de entrega feitas com ele
    tires: int
    active_run: bool  # está numa rota agora (não dá para excluir)


class VehicleDeletion(BaseModel):
    plate: str
    positions: int
    runs: int
    tires: int


class DriverPurge(BaseModel):
    """O que foi apagado ao excluir o motorista de vez."""

    name: str
    runs: int
    gps_points: int  # do rastreador enquanto ele dirigia e do celular nas rotas
    messages: int
    proofs: int  # comprovantes de entrega, com as fotos
    deliveries_kept: int  # entregas feitas por ele que continuam no histórico, sem o nome
    payments: int = 0  # valores lançados para ele (a pagar e pagos)


class DriverReactivate(BaseModel):
    """Recontratação: volta o acesso, opcionalmente com um veículo livre e uma senha nova."""

    vehicle_id: int | None = None
    password: str | None = Field(default=None, min_length=6)


class AdminCreate(BaseModel):
    name: str
    email: EmailStr
    password: str = Field(min_length=8)
