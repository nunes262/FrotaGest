"""Dados de teste para testar o app de ponta a ponta: motoristas com veículo, pneus e rastreador simulado, duas semanas
de rotas feitas (entregas com foto, trajeto, km e pagamentos) e cargas para hoje e amanhã.

Rodar:  python -m app.mock_data            cria os dados de teste (se já existirem, recria com as datas de hoje)
        python -m app.mock_data --remove   apaga só o que este comando criou
        python -m app.mock_data --days 5   histórico mais curto (padrão: 14 dias)

Os motoristas de teste entram com o CPF mostrado no fim e a senha "teste123". O que é de teste é reconhecido pelo CPF
dos motoristas, pela placa dos veículos e pela nota fiscal "TST-..." das entregas. Os endereços já vêm localizados
(sem chamar o Nominatim); o traçado das rotas usa o OSRM e, se ele não responder, a ordem aproximada em linha reta.
"""

import argparse
import logging
import random
import time
import uuid
import zlib
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from xml.sax.saxutils import escape

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import SessionLocal, init_db
from app.models import (
    Company,
    Delivery,
    DeliveryProof,
    DeliveryRun,
    DeliveryStatus,
    DriverPayment,
    FuelEntry,
    GeocodedAddress,
    Position,
    RouteExpense,
    RunStatus,
    Tire,
    TireEvent,
    TrackerProvider,
    TrackerSimulation,
    User,
    UserRole,
    Vehicle,
    VehicleChecklist,
)
from app.services.checklists import ITEMS as CHECKLIST_ITEMS
from app.schemas.tires import POSITIONS_BY_LAYOUT
from app.services import regions, routing, simulator
from app.services.address import normalize
from app.services.drivers import purge_driver
from app.services.trips import company_base
from app.services.expenses import KIND_LABEL
from app.services.vehicles import delete_vehicle


def expenses_label(kind: str) -> str:
    return KIND_LABEL[kind]

log = logging.getLogger("mock_data")

PASSWORD = "teste123"
INVOICE_PREFIX = "TST-"


def valid_cpf(base9: str) -> str:
    """Completa os 9 primeiros dígitos com os dígitos verificadores."""
    digits = [int(c) for c in base9]
    for size in (9, 10):
        total = sum(d * w for d, w in zip(digits, range(size + 1, 1, -1)))
        digits.append((total * 10 % 11) % 10)
    return "".join(map(str, digits))


@dataclass(frozen=True)
class Place:
    customer: str
    address: str
    city: str
    latitude: float
    longitude: float


# Endereços reais com a posição aproximada, por área (a região de preço sai da tabela da empresa)
CENTRO_BH = [
    Place("Padaria Pão Quente", "Av. Afonso Pena, 1500", "Belo Horizonte", -19.9246, -43.9353),
    Place("Drogaria Saúde Mais", "Rua da Bahia, 1148", "Belo Horizonte", -19.9228, -43.9398),
    Place("Mercearia Dois Irmãos", "Av. do Contorno, 6061", "Belo Horizonte", -19.9389, -43.9337),
    Place("Restaurante Sabor de Minas", "Av. Augusto de Lima, 744", "Belo Horizonte", -19.9227, -43.9435),
    Place("Papelaria Central", "Rua dos Carijós, 244", "Belo Horizonte", -19.9187, -43.9399),
    Place("Distribuidora Savassi", "Rua Pernambuco, 1000", "Belo Horizonte", -19.9343, -43.9339),
    Place("Pet Shop Amigo Fiel", "Av. Raja Gabaglia, 1000", "Belo Horizonte", -19.9440, -43.9572),
    Place("Farmácia Belvedere", "Rua Jornalista Jair Silva, 180", "Belo Horizonte", -19.9770, -43.9420),
]
BH_NORTE = [
    Place("Loja de Tintas Cor Viva", "Av. Cristiano Machado, 4000", "Belo Horizonte", -19.8890, -43.9270),
    Place("Açougue Boi Gordo", "Av. Vilarinho, 1300", "Belo Horizonte", -19.8133, -43.9534),
    Place("Empório Pampulha", "Av. Otacílio Negrão de Lima, 6000", "Belo Horizonte", -19.8540, -43.9820),
    Place("Mercado Santa Luzia", "Av. Brasília, 1500", "Santa Luzia", -19.7788, -43.8513),
    Place("Loja Neves", "Av. Denise Cristina da Rocha, 100", "Ribeirão das Neves", -19.7670, -44.0870),
    Place("Farmácia Lagoa Santa", "Av. Acadêmico Nilo Figueiredo, 100", "Lagoa Santa", -19.6275, -43.8936),
    Place("Mercearia Vespasiano", "Rua Nossa Senhora de Fátima, 100", "Vespasiano", -19.6917, -43.9233),
]
OESTE = [
    Place("Mercado Eldorado", "Av. João César de Oliveira, 1500", "Contagem", -19.9363, -44.0431),
    Place("Autopeças Cidade Industrial", "Av. General David Sarnoff, 1500", "Contagem", -19.9578, -44.0158),
    Place("Hortifruti Barreiro", "Av. Afonso Vaz de Melo, 640", "Belo Horizonte", -19.9764, -44.0222),
    Place("Atacado Betim Centro", "Av. Governador Valadares, 1000", "Betim", -19.9678, -44.1977),
    Place("Materiais de Construção Teresópolis", "Av. Edméia Mattos Lazzarotti, 2500", "Betim", -19.9480, -44.1660),
    Place("Padaria Ibirité", "Av. São Paulo, 1000", "Ibirité", -20.0216, -44.0587),
]
SUL_LESTE = [
    Place("Empório Nova Lima", "Rua Bias Fortes, 50", "Nova Lima", -19.9858, -43.8466),
    Place("Drogaria Sabará", "Rua Dom Pedro II, 200", "Sabará", -19.8873, -43.8078),
    Place("Farmácia Belvedere Sul", "Av. Luiz Paulo Franco, 500", "Belo Horizonte", -19.9740, -43.9380),
    Place("Empório Ouro Preto", "Rua Conde de Bobadela, 100", "Ouro Preto", -20.3856, -43.5035),
    Place("Distribuidora Lafaiete", "Av. Telésforo Cândido de Resende, 500", "Conselheiro Lafaiete", -20.6600, -43.7860),
]
INTERIOR = [
    Place("Distribuidora Sete Lagoas", "Av. Getúlio Vargas, 1000", "Sete Lagoas", -19.4651, -44.2466),
    Place("Atacado Itaúna", "Rua Silva Jardim, 100", "Itaúna", -20.0755, -44.5763),
    Place("Supermercado Pará de Minas", "Rua Benedito Valadares, 200", "Pará de Minas", -19.8600, -44.6085),
    Place("Loja Divinópolis", "Av. Primeiro de Junho, 500", "Divinópolis", -20.1446, -44.8838),
]
LONGE = [
    Place("Atacado Ipatinga", "Av. Pedro Linhares Gomes, 1000", "Ipatinga", -19.4680, -42.5370),
    Place("Mercado Valadares", "Av. Minas Gerais, 1700", "Governador Valadares", -18.8510, -41.9490),
    Place("Loja Juiz de Fora", "Av. Barão do Rio Branco, 2000", "Juiz de Fora", -21.7620, -43.3500),
]
ALL_PLACES = CENTRO_BH + BH_NORTE + OESTE + SUL_LESTE + INTERIOR + LONGE


@dataclass(frozen=True)
class MockDriver:
    name: str
    cpf_base: str
    phone: str
    cnh_category: str
    cnh_days_left: int  # vencimento da CNH (um vence logo, para testar o aviso)
    plate: str
    model: str
    capacity_kg: int
    fuel_type: str
    km_per_liter: float
    axle_layout: str
    tread_new_mm: float
    tire_brand: str
    tire_cost: float
    areas: tuple[tuple[Place, ...], ...]  # áreas das rotas dele (às vezes mistura duas)
    kg: tuple[int, int]  # peso de cada entrega
    speed_kmh: float


DRIVERS = (
    MockDriver("Ana Beatriz Rocha", "501234567", "(31) 98811-2201", "B", 900, "RTA1B23", "Fiat Fiorino", 650, "gasolina", 11.0,
               "single", 8.0, "Pirelli Chrono 175/70 R14C", 520, (tuple(CENTRO_BH),), (15, 90), 25),
    MockDriver("Carlos Eduardo Lima", "502345678", "(31) 98822-3302", "B", 600, "SFZ2C34", "Renault Master", 1500, "diesel", 9.0,
               "single", 9.1, "Michelin Agilis 3 225/65 R16C", 980, (tuple(OESTE), tuple(CENTRO_BH)), (40, 260), 32),
    MockDriver("Fernanda Alves", "503456789", "(31) 98833-4403", "B", 20, "PXL3D45", "Mercedes-Benz Sprinter", 1800, "diesel", 8.5,
               "single", 9.5, "Continental VanContact 225/75 R16C", 1150, (tuple(BH_NORTE),), (50, 300), 35),
    MockDriver("Marcos Vinícius Souza", "504567891", "(31) 98844-5504", "C", 1200, "QWE4F56", "VW Delivery Express", 4000, "diesel", 6.0,
               "dual", 14.0, "Bridgestone R268 215/75 R17.5", 1450, (tuple(INTERIOR), tuple(OESTE)), (150, 700), 55),
    MockDriver("Patrícia Gomes", "505678912", "(31) 98855-6605", "B", 400, "RNB5G67", "Iveco Daily 35-150", 3500, "diesel", 7.0,
               "dual", 11.0, "Pirelli Carrier 195/75 R16C", 890, (tuple(SUL_LESTE), tuple(CENTRO_BH)), (80, 450), 40),
    MockDriver("Rodrigo Martins", "506789123", "(31) 98866-7706", "B", 700, "SAM6H78", "Fiat Ducato Cargo", 1500, "diesel", 9.5,
               "single", 9.1, "Pirelli Chrono 225/75 R16C", 1331, (tuple(SUL_LESTE), tuple(LONGE)), (60, 280), 45),
)
PLATES = [d.plate for d in DRIVERS]
CPFS = [valid_cpf(d.cpf_base) for d in DRIVERS]

FAIL_REASONS = (("absent", "Ninguém atendeu; voltei com a mercadoria."), ("refused", "Cliente recusou: pedido errado."),
                ("address", "Número não existe na rua."))
RECEIVERS = ("Maria Souza", "José Almeida", "Ana Paula Lima", "Carlos Henrique", "Luciana Ribeiro", "Paulo Sérgio",
             "Fernanda Costa", "Ricardo Gomes", "Juliana Martins", "Antônio Carlos")
CHECKLIST_PROBLEMS = (("lights", "Seta traseira direita queimada."), ("tires", "Pneu dianteiro esquerdo baixo, calibrei no posto."),
                      ("mirrors", "Retrovisor esquerdo trincado."), ("fluids", "Nível de água do radiador baixo."))
STATIONS = ("Posto Ipiranga Anel Rodoviário", "Posto BR Via Expressa", "Posto Shell Amazonas", "Posto Ale BR-040", "Posto Petrobras Cidade Industrial")
DWELL_MIN = 8  # tempo parado em cada entrega
STEP_S = 60  # uma posição por minuto, como um rastreador comum


def _tz() -> ZoneInfo:
    return ZoneInfo(get_settings().timezone)


def _local(day: date, hour: int, minute: int) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=_tz()).astimezone(timezone.utc)


# ---------- apagar ----------

def remove(db: Session, company: Company) -> dict[str, int]:
    """Apaga só o que é de teste: veículos (com rotas, posições e pneus), motoristas (com pagamentos e fotos) e entregas."""
    vehicles = list(db.scalars(select(Vehicle).where(Vehicle.company_id == company.id, Vehicle.plate.in_(PLATES))))
    for v in vehicles:
        db.execute(update(DeliveryRun).where(DeliveryRun.vehicle_id == v.id, DeliveryRun.status == RunStatus.active)
                   .values(status=RunStatus.finished, finished_at=datetime.now(timezone.utc)))
        db.commit()
        delete_vehicle(db, v)
    drivers = list(db.scalars(select(User).where(User.company_id == company.id, User.cpf.in_(CPFS))))
    for d in drivers:
        purge_driver(db, d)
    mock = select(Delivery.id).where(Delivery.company_id == company.id, Delivery.invoice_number.like(f"{INVOICE_PREFIX}%"))
    folder = Path(get_settings().upload_dir)
    for proof in db.scalars(select(DeliveryProof).where(DeliveryProof.delivery_id.in_(mock))):
        (folder / proof.photo_path).unlink(missing_ok=True)
    db.execute(delete(DeliveryProof).where(DeliveryProof.delivery_id.in_(mock)))
    deliveries = db.execute(delete(Delivery).where(Delivery.id.in_(mock))).rowcount
    db.commit()
    return {"vehicles": len(vehicles), "drivers": len(drivers), "deliveries": deliveries}


# ---------- criar ----------

def _svg_file(company_id: int, folder: str, svg: str) -> str:
    relative = f"{folder}/{company_id}/{uuid.uuid4().hex}.svg"
    path = Path(get_settings().upload_dir) / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(svg, encoding="utf-8")
    return relative


def _signature_svg(rng: random.Random) -> str:
    """Rabisco que lembra uma assinatura."""
    x, points = 20.0, []
    while x < 300:
        points.append(f"{x:.0f},{rng.uniform(40, 110):.0f}")
        x += rng.uniform(12, 30)
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="150" viewBox="0 0 320 150">'
            '<rect width="320" height="150" fill="#fff"/>'
            f'<polyline points="{" ".join(points)}" fill="none" stroke="#1a1a1a" stroke-width="3" stroke-linejoin="round"/>'
            '<line x1="20" y1="125" x2="300" y2="125" stroke="#bbb"/></svg>')


def _receipt_svg(title: str, lines: list[str]) -> str:
    rows = "".join(f'<text x="24" y="{110 + i * 34}" font-size="22" fill="#333">{escape(line)}</text>' for i, line in enumerate(lines))
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="420" height="560" viewBox="0 0 420 560">'
            '<rect width="420" height="560" fill="#fbfbf6"/>'
            f'<text x="24" y="60" font-size="26" font-weight="700" fill="#111" font-family="monospace">{escape(title)}</text>'
            f'<g font-family="monospace">{rows}</g>'
            '<text x="24" y="530" font-size="16" fill="#999" font-family="monospace">Comprovante de teste · FrotaGest</text></svg>')


class Builder:
    def __init__(self, db: Session, company: Company, rng: random.Random):
        self.db, self.company, self.rng = db, company, rng
        base = company_base(company)
        self.base = (base.latitude, base.longitude) if base else None
        self.invoice = 0

    def _invoice(self) -> str:
        self.invoice += 1
        return f"{INVOICE_PREFIX}{self.invoice:04d}"

    def cache_places(self) -> None:
        """Os endereços já entram localizados: iniciar rota não espera o Nominatim."""
        for p in ALL_PLACES:
            key = normalize(f"{p.address} | {p.city}")[:400]
            if not self.db.scalar(select(GeocodedAddress.id).where(GeocodedAddress.query == key)):
                self.db.add(GeocodedAddress(query=key, latitude=p.latitude, longitude=p.longitude, precision="address"))
        self.db.flush()

    def delivery(self, place: Place, day: date, kg: tuple[int, int], **fields) -> Delivery:
        weight = self.rng.randrange(kg[0], kg[1] + 1, 5)
        phone = "319" + str(zlib.crc32(place.customer.encode()) % 10**8).zfill(8)  # mesmo cliente, mesmo telefone (de teste)
        d = Delivery(
            company_id=self.company.id, scheduled_for=day, customer_name=place.customer, customer_phone=phone, address=place.address,
            city=place.city, invoice_number=self._invoice(), weight_kg=weight, volumes=max(1, weight // 25), **fields,
        )
        self.db.add(d)
        return d

    def pick(self, md: MockDriver, count: int) -> list[Place]:
        area = list(self.rng.choice(md.areas))
        self.rng.shuffle(area)
        if area[0] in LONGE:
            count = min(count, 2)  # viagem longa: uma ou duas paradas
        return area[: min(count, len(area))]

    def driver(self, md: MockDriver, cpf: str) -> tuple[User, Vehicle]:
        user = User(
            company_id=self.company.id, name=md.name, cpf=cpf, phone=md.phone, role=UserRole.driver,
            password_hash=hash_password(PASSWORD), cnh_number=valid_cpf(md.cpf_base[::-1])[:11],
            cnh_category=md.cnh_category, cnh_expires_at=date.today() + timedelta(days=md.cnh_days_left),
        )
        self.db.add(user)
        self.db.flush()
        vehicle = Vehicle(
            company_id=self.company.id, plate=md.plate, model=md.model, capacity_kg=md.capacity_kg,
            # Sem integração de verdade: com o rastreador simulado desligado, vale o GPS do celular (o simulador antigo
            # do provedor "mock" geraria posições aleatórias que não têm nada a ver com as rotas)
            tracker_provider=TrackerProvider.sascar, tracker_external_id=f"TESTE-{md.plate}", current_driver_id=user.id,
            fuel_type=md.fuel_type, km_per_liter=md.km_per_liter, axle_layout=md.axle_layout,
        )
        self.db.add(vehicle)
        self.db.flush()
        return user, vehicle

    def tires(self, md: MockDriver, vehicle: Vehicle, measured_at: datetime) -> None:
        for i, position in enumerate(POSITIONS_BY_LAYOUT[md.axle_layout]):
            spare = position == "ESTEPE"
            front = position.startswith("E1")
            pct = 100.0 if spare else float(self.rng.randrange(45, 96))
            tire = Tire(
                company_id=self.company.id, vehicle_id=vehicle.id, position=position, brand=md.tire_brand,
                identification=f"{md.plate[-4:]}-{i + 1:02d}", life_km=(45_000 if front else 70_000) if md.axle_layout == "single" else 80_000,
                measured_pct=pct, measured_at=measured_at, km_at_measure=0, km_at_mount=0, cost=md.tire_cost, retreads=0,
                tread_new_mm=md.tread_new_mm,
            )
            self.db.add(tire)
            self.db.flush()
            self.db.add(TireEvent(tire_id=tire.id, company_id=self.company.id, kind="mount", happened_at=measured_at,
                                  vehicle_km=0, measured_pct=pct, cost=md.tire_cost))

    def finished_run(self, md: MockDriver, user: User, vehicle: Vehicle, day: date, start: datetime,
                     places: list[Place], odometer: float, today: date) -> tuple[float, datetime]:
        """Rota encerrada no passado: plano pelas ruas, posições do rastreador, entregas com foto e o valor da região."""
        deliveries = [self.delivery(p, day, md.kg, driver_id=user.id, status=DeliveryStatus.assigned) for p in places]
        self.db.flush()
        plan = routing.plan_route(self.base, [(p.latitude, p.longitude) for p in places], self.base)
        if plan.optimized:
            time.sleep(0.2)  # o OSRM público pede uso leve
        order = [deliveries[i] for i in plan.order]
        run = DeliveryRun(
            company_id=self.company.id, driver_id=user.id, vehicle_id=vehicle.id, day=day, status=RunStatus.finished,
            started_at=start, origin_latitude=self.base[0] if self.base else None,
            origin_longitude=self.base[1] if self.base else None, returns_to_base=self.base is not None,
            planned_distance_km=plan.distance_km, planned_duration_min=plan.duration_min, optimized=plan.optimized,
            geometry=plan.geometry, km_source="tracker", load_kg=round(sum(d.weight_kg for d in deliveries), 1),
            plan=[{"delivery_id": d.id, "leg_km": leg, "latitude": places[i].latitude, "longitude": places[i].longitude,
                   "precision": "address"} for d, i, leg in zip(order, plan.order, plan.legs_km)],
        )
        self.db.add(run)
        self.db.flush()
        regions.apply_to_run(self.db, run, [(p.city, p.latitude, p.longitude) for p in places])
        if self.rng.random() < 0.92:  # quase sempre faz o checklist antes de sair
            problem = self.rng.choice(CHECKLIST_PROBLEMS) if self.rng.random() < 0.15 else None
            items = [{"key": k, "ok": not problem or k != problem[0], "note": problem[1] if problem and k == problem[0] else None, "photo": None}
                     for k, _ in CHECKLIST_ITEMS]
            self.db.add(VehicleChecklist(company_id=self.company.id, driver_id=user.id, vehicle_id=vehicle.id, run_id=run.id,
                                         odometer_km=round(48_000 + odometer), items=items, issues=1 if problem else 0,
                                         created_at=start - timedelta(minutes=8)))
        for n, d in enumerate(order, start=1):
            d.stop_order, d.run_id = n, run.id

        # Anda pelo traçado: uma posição por minuto, parado alguns minutos em cada entrega
        track = simulator.build_track(run)
        t, progress = start, 0.0
        targets = [m for _, m in track.stops] + [track.length] if track else []
        positions: list[Position] = []

        def emit(m: float, speed: float, ignition: bool) -> None:
            lat, lon = track.at(m)
            positions.append(Position(vehicle_id=vehicle.id, driver_id=user.id, recorded_at=t, latitude=lat, longitude=lon,
                                      speed_kmh=round(speed, 1), ignition=ignition, odometer_km=round(odometer + m / 1000, 3),
                                      simulated=True))

        cruise = 70 if track and track.length > 150_000 else md.speed_kmh  # viagem longa é quase toda em estrada
        for i, target in enumerate(targets):
            while progress < target - 1:
                speed = cruise * self.rng.uniform(0.7, 1.2)
                progress = min(target, progress + speed / 3.6 * STEP_S)
                t += timedelta(seconds=STEP_S)
                emit(progress, speed, True)
            if i < len(order):
                d = order[i]
                arrived = t
                for _ in range(DWELL_MIN // 2):
                    t += timedelta(minutes=2)
                    emit(progress, 0, False)
                failed = self.rng.random() < 0.12
                self.proof(d, user, arrived + timedelta(minutes=3), failed, track.at(progress))
        if not track:  # sem a base não há traçado: só os comprovantes
            for d, i in zip(order, plan.order):
                self.proof(d, user, t, self.rng.random() < 0.12, (places[i].latitude, places[i].longitude))
        finished = t + timedelta(minutes=5)
        run.finished_at = finished
        run.distance_km = round(track.length / 1000, 2) if track else 0.0
        self.db.add_all(positions)

        self.expenses(user, run, day, today, places, finished)

        # Valor da rota pela região: as mais antigas já pagas, as recentes a receber
        if run.region_price_cents:
            paid = (today - day).days >= 5
            payment = DriverPayment(
                company_id=self.company.id, driver_id=user.id, amount_cents=run.region_price_cents,
                description=f"Rota de {day.strftime('%d/%m')} · {run.region_name}",
                status="paid" if paid else "pending", paid_on=min(today, day + timedelta(days=4)) if paid else None,
            )
            self.db.add(payment)
            self.db.flush()
            run.payment_id = payment.id
        return odometer + (track.length / 1000 if track else 0.0), finished

    def expenses(self, user: User, run: DeliveryRun, day: date, today: date, places: list[Place], when: datetime) -> None:
        """Pedágio nas viagens para fora da Grande BH, estacionamento no centro e, às vezes, chapa na descarga."""
        far = any(p in INTERIOR or p in LONGE or p in SUL_LESTE[3:] for p in places)
        wanted = []
        if far:
            wanted += [("toll", round(self.rng.uniform(6.5, 18.9), 2), "Praça de pedágio na BR")] * self.rng.randint(1, 2)
        elif self.rng.random() < 0.3:
            wanted.append(("parking", float(self.rng.choice([8, 10, 12, 15])), "Rotativo no centro"))
        if self.rng.random() < 0.1:
            wanted.append(("unloading", float(self.rng.choice([50, 60, 80])), "Chapa para descarregar"))
        old = (today - day).days >= 5
        for kind, amount, note in wanted:
            status = ("approved" if self.rng.random() < 0.85 else "rejected") if old else "pending"
            expense = RouteExpense(
                company_id=self.company.id, driver_id=user.id, run_id=run.id, kind=kind, amount_cents=round(amount * 100),
                note=note, status=status, spent_at=when - timedelta(minutes=self.rng.randint(30, 200)),
                photo_path=_svg_file(self.company.id, "expenses", _receipt_svg("RECIBO", [note, f"Valor: R$ {amount:.2f}".replace(".", ","), day.strftime("%d/%m/%Y")])),
                reject_reason="Comprovante sem CNPJ." if status == "rejected" else None,
                reviewed_at=when + timedelta(days=1) if old else None,
            )
            self.db.add(expense)
            if status == "approved":
                payment = DriverPayment(
                    company_id=self.company.id, driver_id=user.id, amount_cents=expense.amount_cents,
                    description=f"Reembolso · {expenses_label(kind)} · {day.strftime('%d/%m')}", status="paid",
                    paid_on=min(today, day + timedelta(days=4)),
                )
                self.db.add(payment)
                self.db.flush()
                expense.payment_id = payment.id

    def refuel(self, md: MockDriver, user: User, vehicle: Vehicle, km: float, odometer: float, when: datetime) -> None:
        price = self.rng.uniform(6.2, 6.9) if md.fuel_type == "diesel" else self.rng.uniform(6.0, 6.5)
        liters = round(km / md.km_per_liter * self.rng.uniform(0.95, 1.12), 1)
        total = round(liters * price, 2)
        station = self.rng.choice(STATIONS)
        self.db.add(FuelEntry(
            company_id=self.company.id, vehicle_id=vehicle.id, driver_id=user.id, filled_at=when, liters=liters,
            total_cents=round(total * 100), odometer_km=round(48_000 + odometer), fuel_type=md.fuel_type, full_tank=True, station=station,
            photo_path=_svg_file(self.company.id, "fuel", _receipt_svg(station.upper()[:24], [
                f"{'DIESEL S10' if md.fuel_type == 'diesel' else 'GASOLINA'}", f"{liters:.1f} L x R$ {price:.3f}".replace(".", ","),
                f"TOTAL R$ {total:.2f}".replace(".", ","), when.astimezone(_tz()).strftime("%d/%m/%Y %H:%M")])),
        ))

    def proof(self, d: Delivery, user: User, when: datetime, failed: bool, where: tuple[float, float]) -> None:
        reason, note = self.rng.choice(FAIL_REASONS) if failed else (None, self.rng.choice(
            ["Recebido pelo gerente.", "Deixado com o porteiro.", "Conferido e assinado.", None]))
        relative = f"proofs/{self.company.id}/{uuid.uuid4().hex}.svg"
        path = Path(get_settings().upload_dir) / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(simulator._proof_svg(d.customer_name, when), encoding="utf-8")
        signed = not failed and self.rng.random() < 0.7
        self.db.add(DeliveryProof(
            delivery_id=d.id, company_id=self.company.id, driver_id=user.id, outcome="failed" if failed else "delivered",
            reason=reason, note=note, photo_path=relative, latitude=where[0], longitude=where[1], created_at=when,
            receiver_name=None if failed else self.rng.choice(RECEIVERS),
            receiver_document=f"MG-{self.rng.randint(10, 22)}.{self.rng.randint(100, 999)}.{self.rng.randint(100, 999)}" if signed and self.rng.random() < 0.5 else None,
            signature_path=_svg_file(self.company.id, "signatures", _signature_svg(self.rng)) if signed else None,
        ))
        d.status = DeliveryStatus.failed if failed else DeliveryStatus.delivered


def create(db: Session, company: Company, days: int = 14, seed: int | None = None) -> dict:
    """Recria os dados de teste com as datas de hoje."""
    remove(db, company)
    rng = random.Random(seed)
    b = Builder(db, company, rng)
    b.cache_places()
    today = datetime.now(_tz()).date()
    history_start = today - timedelta(days=days)
    created = {"drivers": [], "runs": 0, "deliveries_today": 0, "queue": 0}

    for md, cpf in zip(DRIVERS, CPFS):
        user, vehicle = b.driver(md, cpf)
        b.tires(md, vehicle, _local(history_start, 6, 0))
        odometer = 0.0
        since_fill = 0.0
        tank_km = 520 if md.axle_layout == "dual" else 380  # roda isso entre um tanque cheio e outro
        last_end = _local(history_start, 0, 0)
        for offset in range(days, 0, -1):
            day = today - timedelta(days=offset)
            if day.weekday() == 6 or rng.random() < 0.12:
                continue  # domingo e alguns dias de folga
            hour = rng.choice([7, 7, 8])
            start = _local(day, hour, rng.choice([10, 25, 40, 55]))
            if start < last_end + timedelta(hours=11):
                continue  # voltou tarde de uma viagem longa: descanso de 11 h entre jornadas (Lei 13.103)
            before = odometer
            odometer, last_end = b.finished_run(md, user, vehicle, day, start, b.pick(md, rng.randint(3, 6)), odometer, today)
            created["runs"] += 1
            if last_end < _local(day, 13, 0) and rng.random() < 0.35:
                # Voltou cedo: almoça, carrega de novo e sai para a segunda rota do dia
                second = max(last_end + timedelta(minutes=75), _local(day, 13, 0))
                odometer, last_end = b.finished_run(md, user, vehicle, day, second, b.pick(md, rng.randint(2, 4)), odometer, today)
                created["runs"] += 1
            since_fill += odometer - before
            if since_fill >= tank_km:
                b.refuel(md, user, vehicle, since_fill, odometer, last_end + timedelta(minutes=10))
                since_fill = 0.0

        # Hoje: carga já no caminhão, pronta para "Iniciar rota"
        for n, place in enumerate(b.pick(md, rng.randint(3, 5)), start=1):
            b.delivery(place, today, md.kg, driver_id=user.id, status=DeliveryStatus.assigned, stop_order=n)
            created["deliveries_today"] += 1
        # Amanhã: alguns já com carga marcada
        if md.axle_layout == "dual" or md.capacity_kg <= 650:
            for n, place in enumerate(b.pick(md, 3), start=1):
                b.delivery(place, today + timedelta(days=1), md.kg, driver_id=user.id, status=DeliveryStatus.assigned, stop_order=n)

        # Rastreador simulado ligado: o caminhão aparece na base e anda quando a rota começa
        sim = simulator.start(db, vehicle)
        sim.speed_factor, sim.dwell_min = 20, 2
        db.commit()  # um motorista por vez: não segura o banco (SQLite) enquanto o OSRM responde
        created["drivers"].append((md.name, cpf, md.plate, md.model))

    # Fila do carregamento: entregas de hoje e de amanhã esperando caminhão
    for place in rng.sample(CENTRO_BH + OESTE + BH_NORTE, 6) + rng.sample(INTERIOR + SUL_LESTE, 2):
        b.delivery(place, today, (40, 400), status=DeliveryStatus.pending)
        created["queue"] += 1
    for place in rng.sample(ALL_PLACES, 4):
        b.delivery(place, today + timedelta(days=1), (40, 400), status=DeliveryStatus.pending)
    db.commit()
    return created


def _fmt_cpf(cpf: str) -> str:
    return f"{cpf[:3]}.{cpf[3:6]}.{cpf[6:9]}-{cpf[9:]}"


def main() -> None:
    logging.basicConfig(level=logging.WARNING)
    parser = argparse.ArgumentParser(description="Dados de teste do FrotaGest")
    parser.add_argument("--remove", action="store_true", help="apaga os dados de teste")
    parser.add_argument("--days", type=int, default=14, help="dias de histórico (padrão: 14)")
    parser.add_argument("--company", type=int, help="id da empresa (padrão: a primeira)")
    args = parser.parse_args()
    init_db()
    with SessionLocal() as db:
        company = db.get(Company, args.company) if args.company else db.scalar(select(Company).order_by(Company.id).limit(1))
        if not company:
            raise SystemExit("Nenhuma empresa no banco. Rode antes: python -m app.seed")
        if args.remove:
            print("Dados de teste apagados:", remove(db, company))
            return
        print(f"Criando dados de teste em “{company.name}” ({args.days} dias de histórico)… o traçado usa o OSRM, pode levar 1 min.")
        result = create(db, company, days=args.days)
        print(f"\n{result['runs']} rotas feitas, {result['deliveries_today']} entregas nos caminhões hoje e {result['queue']} na fila do carregamento.")
        print(f"\nMotoristas de teste (senha: {PASSWORD}):")
        for name, cpf, plate, model in result["drivers"]:
            print(f"  {name:<24} CPF {_fmt_cpf(cpf)}   {plate} · {model}")


if __name__ == "__main__":
    main()
