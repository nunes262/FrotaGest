import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.api.routes import (
    address, auth, chat, company, costs, deliveries, dev, fleet, operations, payments, regions, runs, tires, trackers, tracking,
)
from app.core.config import get_settings
from app.db.session import init_db
from app.services import simulator

settings = get_settings()
log = logging.getLogger(__name__)


async def poll_loop(interval: int) -> None:
    from app.workers import poller

    while True:
        try:
            await asyncio.to_thread(poller.run_once)
        except Exception:
            log.exception("Falha na coleta; tentando de novo em %s s", interval)
        await asyncio.sleep(interval)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    if settings.seed_on_start:
        from app.seed import seed

        seed()
    loops = []
    # Rastreador simulado das opções de desenvolvedor
    if settings.dev_tools and settings.simulator_tick_seconds > 0:
        loops.append(asyncio.create_task(simulator.run_loop(settings.simulator_tick_seconds)))
    if settings.run_poller:
        loops.append(asyncio.create_task(poll_loop(settings.poll_interval_seconds)))
    yield
    for loop in loops:
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


# Painel web: os arquivos do build e, para as rotas do React, o index.html
if settings.static_dir:
    static_root = Path(settings.static_dir).resolve()

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def frontend(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(status_code=404)
        file = (static_root / path).resolve()
        if path and file.is_file() and file.is_relative_to(static_root):
            # Os arquivos de /assets têm hash no nome e podem ficar em cache para sempre
            cache = "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
            return FileResponse(file, headers={"Cache-Control": cache})
        return FileResponse(static_root / "index.html", headers={"Cache-Control": "no-cache"})
