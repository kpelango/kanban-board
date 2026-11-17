import hmac
import os

from fastapi import APIRouter, Header, HTTPException, status

from app import db

router = APIRouter(prefix="/api/cron", tags=["cron"])


@router.get("/cleanup-guests")
def cleanup_guests(authorization: str = Header(default="")) -> dict[str, int]:
    """Called daily by Vercel Cron, which sends `Authorization: Bearer $CRON_SECRET`."""
    secret = os.getenv("CRON_SECRET", "")
    # Fails closed: with no secret configured, nobody can trigger it
    if not secret or not hmac.compare_digest(authorization.encode(), f"Bearer {secret}".encode()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authorized")
    return {"deleted": db.delete_expired_guests()}
