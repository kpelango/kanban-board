from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.ai import board_conversations_router, conversations_router, router as ai_router
from app.admin import router as admin_router
from app.auth import router as auth_router
from app.board import router as board_router
from app import db
from app.auth import get_serializer

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    get_serializer()  # fail fast when SESSION_SECRET_KEY is missing
    db.seed_dev_users()  # no-op unless SEED_DEV_USERS=1
    yield
    db.close_pool()


app = FastAPI(title="Kanban Studio API", lifespan=lifespan)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(board_router)
app.include_router(ai_router)
app.include_router(board_conversations_router)
app.include_router(conversations_router)


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "message": "Hello from FastAPI"}


if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
