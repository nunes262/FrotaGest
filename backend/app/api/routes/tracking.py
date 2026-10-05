from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.core.config import get_settings
from app.models import Company, Delivery, DeliveryRun, DeliveryStatus, Position, RunPoint, RunStatus, User, UserRole, Vehicle
from app.schemas.tracking import (
    DashboardSummary, LivePosition, RouteDetail, RoutePoint, RouteSummary, TrailRun, TrailStop, TripOut, VehicleTrail,
)
from app.services.geo import as_utc, count_speeding_events, driving_minutes, route_distance_km
from app.services.runs import downsample, phone_distance_km
from app.services.trips import company_base, is_at_base, split_trips

router = APIRouter(prefix="/tracking", tags=["rastreamento"])
OFFLINE_AFTER = timedelta(minutes=30)


def _tz() -> ZoneInfo:
    return ZoneInfo(get_settings().timezone)


def _today() -> date:
    return datetime.now(_tz()).date()


def _day_bounds(d_from: date, d_to: date) -> tuple[datetime, datetime]:
    """Início e fim dos dias no fuso local, convertidos para UTC (como o banco guarda)."""
    tz = _tz()
    return (
        datetime.combine(d_from, time.min, tzinfo=tz).astimezone(timezone.utc),
        datetime.combine(d_to, time.max, tzinfo=tz).astimezone(timezone.utc),
    )


@router.get("/live", response_model=list[LivePosition])
def live(db: DbSession, user: CurrentUser):
    """Última posição de cada veículo da empresa."""
    settings = get_settings()
    base = company_base(db.get(Company, user.company_id))
    latest = (
        select(Position.vehicle_id, func.max(Position.recorded_at).label("t"))
        .join(Vehicle, Vehicle.id == Position.vehicle_id)
        .where(Vehicle.company_id == user.company_id)
        .group_by(Position.vehicle_id)
        .subquery()
    )
    rows = db.execute(
        select(Position, Vehicle, User)
        .join(latest, (Position.vehicle_id == latest.c.vehicle_id) & (Position.recorded_at == latest.c.t))
        .join(Vehicle, Vehicle.id == Position.vehicle_id)
        .outerjoin(User, User.id == Position.driver_id)
        .order_by(Vehicle.plate)
    ).all()

    now = datetime.now(timezone.utc)
    out = []
    for pos, vehicle, driver in rows:
        if user.role == UserRole.driver and pos.driver_id != user.id:
            continue
        recorded = as_utc(pos.recorded_at)
        if now - recorded > OFFLINE_AFTER:
            status = "offline"
        elif base and is_at_base(pos.latitude, pos.longitude, base):
            status = "at_base"
        elif pos.speed_kmh > settings.speed_limit_kmh:
            status = "speeding"
        elif pos.ignition and pos.speed_kmh > 5:
            status = "moving"
        else:
            status = "stopped"
        out.append(
            LivePosition(
                vehicle_id=vehicle.id,
                plate=vehicle.plate,
                driver_id=pos.driver_id,
                driver_name=driver.name if driver else None,
                latitude=pos.latitude,
                longitude=pos.longitude,
                speed_kmh=pos.speed_kmh,
                ignition=pos.ignition,
                recorded_at=recorded,
                status=status,
            )
        )
    return out


@router.get("/routes", response_model=list[RouteSummary])
def routes(
    db: DbSession,
    user: CurrentUser,
    date_from: date | None = None,
    date_to: date | None = None,
    driver_id: int | None = None,
    vehicle_id: int | None = None,
):
    """Rotas realizadas, agrupadas por dia, motorista e veículo."""
    date_to = date_to or _today()
    date_from = date_from or date_to - timedelta(days=6)
    if date_to < date_from:
        raise HTTPException(400, "A data final deve ser igual ou posterior à inicial.")
    if user.role == UserRole.driver:
        driver_id = user.id  # motorista só vê as próprias rotas

    start, end = _day_bounds(date_from, date_to)
    q = (
        select(Position, Vehicle.plate)
        .join(Vehicle, Vehicle.id == Position.vehicle_id)
        .where(Vehicle.company_id == user.company_id, Position.recorded_at.between(start, end))
        .order_by(Position.vehicle_id, Position.recorded_at)
    )
    if driver_id:
        q = q.where(Position.driver_id == driver_id)
    if vehicle_id:
        q = q.where(Position.vehicle_id == vehicle_id)

    groups: dict[tuple, list[Position]] = defaultdict(list)
    plates: dict[int, str] = {}
    for pos, plate in db.execute(q).all():
        plates[pos.vehicle_id] = plate
        groups[(as_utc(pos.recorded_at).astimezone(_tz()).date(), pos.driver_id, pos.vehicle_id)].append(pos)

    driver_ids = {k[1] for k in groups if k[1]}
    names = dict(db.execute(select(User.id, User.name).where(User.id.in_(driver_ids))).all()) if driver_ids else {}
    limit = get_settings().speed_limit_kmh

    summaries = [
        RouteSummary(
            day=day,
            driver_id=d_id,
            driver_name=names.get(d_id),
            vehicle_id=v_id,
            plate=plates[v_id],
            distance_km=route_distance_km(points),
            driving_minutes=driving_minutes(points),
            max_speed_kmh=max(p.speed_kmh for p in points),
            speeding_events=count_speeding_events(points, limit),
            started_at=as_utc(points[0].recorded_at),
            ended_at=as_utc(points[-1].recorded_at),
        )
        for (day, d_id, v_id), points in groups.items()
    ]
    return sorted(summaries, key=lambda s: (s.day, s.driver_name or ""), reverse=True)


def _day_positions(db: DbSession, vehicle_id: int, day: date, user: User) -> list[Position]:
    vehicle = db.get(Vehicle, vehicle_id)
    if not vehicle or vehicle.company_id != user.company_id:
        raise HTTPException(404, "Veículo não encontrado.")
    start, end = _day_bounds(day, day)
    q = select(Position).where(Position.vehicle_id == vehicle_id, Position.recorded_at.between(start, end))
    if user.role == UserRole.driver:
        q = q.where(Position.driver_id == user.id)
    return list(db.scalars(q.order_by(Position.recorded_at)).all())


def _route_point(p: Position) -> RoutePoint:
    return RoutePoint(latitude=p.latitude, longitude=p.longitude, speed_kmh=p.speed_kmh, recorded_at=as_utc(p.recorded_at))


@router.get("/routes/{vehicle_id}/points", response_model=list[RoutePoint])
def route_points(vehicle_id: int, day: date, db: DbSession, user: CurrentUser):
    return [_route_point(p) for p in _day_positions(db, vehicle_id, day, user)]


@router.get("/routes/{vehicle_id}/detail", response_model=RouteDetail)
def route_detail(vehicle_id: int, day: date, db: DbSession, user: CurrentUser):
    """Pontos do dia e as viagens a partir da base (vazio se a empresa ainda não definiu a base)."""
    points = _day_positions(db, vehicle_id, day, user)
    base = company_base(db.get(Company, user.company_id))
    trips = split_trips(points, base) if base else []
    return RouteDetail(
        points=[_route_point(p) for p in points],
        trips=[
            TripOut(
                start_index=t.start,
                end_index=t.end,
                left_at=as_utc(points[t.start].recorded_at),
                returned_at=as_utc(points[t.end].recorded_at) if t.returned else None,
                left_base=t.left_base,
                distance_km=t.distance_km,
            )
            for t in trips
        ],
    )


MAX_TRAIL_POINTS = 800


def _trail_run(db: DbSession, run: DeliveryRun) -> TrailRun:
    statuses = dict(db.execute(
        select(Delivery.id, Delivery.status).where(Delivery.driver_id == run.driver_id, Delivery.scheduled_for == run.day)
    ).all())
    names = dict(db.execute(select(Delivery.id, Delivery.customer_name).where(Delivery.id.in_(statuses))).all())
    stops = [p for p in run.plan if p.get("latitude") is not None and p["delivery_id"] in statuses]
    return TrailRun(
        id=run.id,
        status=run.status.value,
        geometry=[tuple(p) for p in run.geometry],
        stops=[
            TrailStop(order=i, delivery_id=p["delivery_id"], customer_name=names[p["delivery_id"]], latitude=p["latitude"],
                      longitude=p["longitude"], status=statuses[p["delivery_id"]].value)
            for i, p in enumerate(stops, start=1)
        ],
    )


@router.get("/trails", response_model=list[VehicleTrail])
def trails(db: DbSession, user: CurrentUser, day: date | None = None):
    """Caminho percorrido por veículo no dia e, se houver, a rota de entrega dele (traçado planejado e paradas).
    O motorista vê só o dele."""
    day = day or _today()
    start, end = _day_bounds(day, day)
    vq = select(Vehicle).where(Vehicle.company_id == user.company_id)
    if user.role == UserRole.driver:
        vq = vq.where(Vehicle.current_driver_id == user.id)
    out = []
    for vehicle in db.scalars(vq.order_by(Vehicle.plate)):
        q = select(Position).where(Position.vehicle_id == vehicle.id, Position.recorded_at.between(start, end))
        if user.role == UserRole.driver:
            q = q.where(Position.driver_id == user.id)
        points: list = list(db.scalars(q.order_by(Position.recorded_at)))
        run = db.scalar(
            select(DeliveryRun)
            .where(DeliveryRun.vehicle_id == vehicle.id, (DeliveryRun.status == RunStatus.active) | (DeliveryRun.day == day))
            .order_by((DeliveryRun.status == RunStatus.active).desc(), DeliveryRun.started_at.desc())
            .limit(1)
        )
        distance = route_distance_km(points)
        if not points and run:  # sem rastreador: o caminho do celular do motorista
            points = list(db.scalars(select(RunPoint).where(RunPoint.run_id == run.id).order_by(RunPoint.recorded_at)))
            distance = phone_distance_km(points)
        if not points and not run:
            continue
        driver_id = points[-1].driver_id if points and isinstance(points[-1], Position) else None
        driver_id = driver_id or (run.driver_id if run else vehicle.current_driver_id)
        driver = db.get(User, driver_id) if driver_id else None
        out.append(VehicleTrail(
            vehicle_id=vehicle.id,
            plate=vehicle.plate,
            driver_id=driver_id,
            driver_name=driver.name if driver else None,
            points=[(p.latitude, p.longitude) for p in downsample(points, MAX_TRAIL_POINTS)],
            distance_km=distance,
            run=_trail_run(db, run) if run else None,
        ))
    return out


@router.get("/summary", response_model=DashboardSummary)
def summary(db: DbSession, user: CurrentUser):
    vehicles_total = db.scalar(select(func.count(Vehicle.id)).where(Vehicle.company_id == user.company_id)) or 0
    live_rows = live(db, user)
    today = routes(db, user, date_from=_today(), date_to=_today())
    deliveries = select(Delivery.status, func.count(Delivery.id)).where(
        Delivery.company_id == user.company_id, Delivery.scheduled_for == _today()
    )
    if user.role == UserRole.driver:
        deliveries = deliveries.where(Delivery.driver_id == user.id)
    by_status = dict(db.execute(deliveries.group_by(Delivery.status)).all())
    return DashboardSummary(
        vehicles_total=vehicles_total,
        vehicles_moving=sum(1 for r in live_rows if r.status in ("moving", "speeding")),
        km_today=round(sum(r.distance_km for r in today), 1),
        deliveries_today=sum(by_status.values()),
        deliveries_pending=by_status.get(DeliveryStatus.pending, 0),
    )
