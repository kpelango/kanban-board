from fastapi import APIRouter, Depends, HTTPException, Response, status

from app import db
from app.auth import CurrentUser, get_current_user
from app.schemas import ResetPasswordRequest, SetAdminRequest, UserSummary

router = APIRouter(prefix="/api/admin/users", tags=["admin"])


def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admins only")
    return user


def existing_user(user_id: int) -> int:
    if not db.user_exists(user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user_id


def not_self(user_id: int, admin: CurrentUser, action: str) -> None:
    if user_id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"You cannot {action} your own account here",
        )


@router.get("", response_model=list[UserSummary])
def list_users(_: CurrentUser = Depends(require_admin)) -> list[UserSummary]:
    return db.list_users()


@router.put("/{user_id}/password")
def reset_password(
    payload: ResetPasswordRequest,
    _: CurrentUser = Depends(require_admin),
    user_id: int = Depends(existing_user),
) -> dict[str, str]:
    db.set_password(user_id, payload.newPassword)
    return {"status": "password_reset"}


@router.patch("/{user_id}", response_model=UserSummary)
def set_admin(
    payload: SetAdminRequest,
    admin: CurrentUser = Depends(require_admin),
    user_id: int = Depends(existing_user),
) -> UserSummary:
    if not payload.isAdmin:
        not_self(user_id, admin, "remove admin rights from")
    db.set_admin(user_id, payload.isAdmin)
    summary = db.get_user_summary(user_id)
    assert summary is not None
    return summary


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    admin: CurrentUser = Depends(require_admin),
    user_id: int = Depends(existing_user),
) -> Response:
    not_self(user_id, admin, "delete")
    db.delete_user(user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
