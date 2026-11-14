from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.auth import router as auth_router
from app.board import router as board_router
from app.db import init_db

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    init_db()
    yield


app = FastAPI(title="Kanban Studio API", lifespan=lifespan)
app.include_router(auth_router)
app.include_router(board_router)


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "message": "Hello from FastAPI"}


if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
