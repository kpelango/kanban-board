from fastapi import APIRouter, Depends

from app.auth import get_current_username
from app.db import get_board_for_user, save_board_for_user
from app.schemas import BoardData

router = APIRouter(prefix="/api/board", tags=["board"])


@router.get("", response_model=BoardData)
def read_board(username: str = Depends(get_current_username)) -> BoardData:
    return get_board_for_user(username)


@router.put("", response_model=BoardData)
def update_board(
    board: BoardData,
    username: str = Depends(get_current_username),
) -> BoardData:
    return save_board_for_user(username, board)
