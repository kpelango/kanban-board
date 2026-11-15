import hashlib
import os
import secrets
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from itsdangerous import BadSignature, URLSafeTimedSerializer

from app import db
from app.schemas import (
    ChangePasswordRequest,
    Credentials,
    DeleteAccountRequest,
    RegisterRequest,
    UserResponse,
)

SESSION_COOKIE_NAME = "pm_session"
SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7


@cache
def _secret_from_file(path: Path) -> str:
    """Reads the generated session secret, creating it (owner-only) on first use."""
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return path.read_text().strip()
    with os.fdopen(fd, "w") as handle:
        secret = secrets.token_urlsafe(32)
        handle.write(secret)
    return secret


def get_serializer() -> URLSafeTimedSerializer:
    secret = os.getenv("SESSION_SECRET_KEY") or _secret_from_file(
        db.get_db_path().parent / "session_secret"
    )
    return URLSafeTimedSerializer(secret, salt="pm-auth-session")


def password_fingerprint(password_hash: str) -> str:
    """Changes whenever the password changes, so older session cookies stop working."""
    return hashlib.sha256(password_hash.encode("utf-8")).hexdigest()[:16]

router = APIRouter(prefix="/api/auth", tags=["auth"])


@dataclass
class CurrentUser:
    id: int
    username: str
    is_admin: bool = False


def unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def get_current_user(
    pm_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> CurrentUser:
    if not pm_session:
        raise unauthorized("Not authenticated")
    try:
        data = get_serializer().loads(pm_session, max_age=SESSION_MAX_AGE_SECONDS)
    except BadSignature as exc:
        raise unauthorized("Invalid or expired session") from exc
    username = data.get("username") if isinstance(data, dict) else None
    user = db.get_user(username) if isinstance(username, str) else None
    if user is None or data.get("pw") != password_fingerprint(user.password_hash):
        raise unauthorized("Invalid session")
    return CurrentUser(id=user.id, username=username, is_admin=user.is_admin)


def start_session(response: Response, username: str) -> UserResponse:
    user = db.get_user(username)
    assert user is not None
    token = get_serializer().dumps(
        {"username": username, "pw": password_fingerprint(user.password_hash)}
    )
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=SESSION_MAX_AGE_SECONDS,
        path="/",
    )
    return UserResponse(username=username, isAdmin=user.is_admin)


@router.post("/login", response_model=UserResponse)
def login(payload: Credentials, response: Response) -> UserResponse:
    username = db.authenticate(payload.username.strip(), payload.password)
    if username is None:
        raise unauthorized("Invalid username or password")
    return start_session(response, username)


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, response: Response) -> UserResponse:
    if db.create_user(payload.username, payload.password) is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Username is already taken"
        )
    return start_session(response, payload.username)


@router.post("/logout")
def logout(response: Response) -> dict[str, str]:
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return {"status": "logged_out"}


@router.get("/me", response_model=UserResponse)
def me(user: CurrentUser = Depends(get_current_user)) -> UserResponse:
    return UserResponse(username=user.username, isAdmin=user.is_admin)


@router.put("/password")
def change_password(
    payload: ChangePasswordRequest,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> dict[str, str]:
    if db.authenticate(user.username, payload.currentPassword) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect"
        )
    db.set_password(user.id, payload.newPassword)
    # Other sessions are now invalid; keep this one signed in with a fresh cookie
    start_session(response, user.username)
    return {"status": "password_changed"}


@router.delete("/account")
def delete_account(
    payload: DeleteAccountRequest,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> dict[str, str]:
    if db.authenticate(user.username, payload.password) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Password is incorrect"
        )
    db.delete_user(user.id)
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return {"status": "account_deleted"}
