import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (
    address, auth, chat, company, costs, deliveries, dev, fleet, operations, payments, regions, runs, tires, trackers, tracking,
)
from app.core.config import get_settings
from app.db.session import init_db
from app.services import simulator

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    # Rastreador simulado das opções de desenvolvedor
    loop = None
    if settings.dev_tools and settings.simulator_tick_seconds > 0:
        loop = asyncio.create_task(simulator.run_loop(settings.simulator_tick_seconds))
    yield
    if loop:
        loop.cancel()
        with suppress(asyncio.CancelledError):
            await loop


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (
    auth.router, company.router, fleet.router, tracking.router, deliveries.router, chat.router, address.router,
    runs.router, tires.router, costs.router, trackers.router, dev.router, payments.router,
    regions.router, *operations.routers,
):
    app.include_router(r, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok"}
