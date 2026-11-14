import os
from fastapi import APIRouter, Cookie, HTTPException, Response, status
from itsdangerous import BadSignature, URLSafeTimedSerializer
from pydantic import BaseModel

SESSION_COOKIE_NAME = "pm_session"
SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7
SECRET_KEY = os.getenv("SESSION_SECRET_KEY", "pm-mvp-local-secret-key")
VALID_USERNAME = "user"
VALID_PASSWORD = "password"

serializer = URLSafeTimedSerializer(SECRET_KEY, salt="pm-auth-session")

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    username: str


def create_session_token(username: str) -> str:
    return serializer.dumps({"username": username})


def verify_session_token(token: str | None) -> str:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    try:
        data = serializer.loads(token, max_age=SESSION_MAX_AGE_SECONDS)
    except BadSignature as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session",
        ) from exc

    username = data.get("username")
    if not isinstance(username, str) or not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid session payload",
        )
    return username


def get_current_username(
    pm_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> str:
    return verify_session_token(pm_session)


@router.post("/login", response_model=UserResponse)
def login(payload: LoginRequest, response: Response) -> UserResponse:
    if payload.username != VALID_USERNAME or payload.password != VALID_PASSWORD:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    token = create_session_token(payload.username)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=SESSION_MAX_AGE_SECONDS,
        path="/",
    )
    return UserResponse(username=payload.username)


@router.post("/logout")
def logout(response: Response) -> dict[str, str]:
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return {"status": "logged_out"}


@router.get("/me", response_model=UserResponse)
def me(
    pm_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> UserResponse:
    username = verify_session_token(pm_session)
    return UserResponse(username=username)
