from fastapi import APIRouter, Depends, HTTPException, Response, status

from app import db
from app.auth import CurrentUser, get_current_user
from app.schemas import BoardData, BoardSummary, CreateBoardRequest, RenameRequest

router = APIRouter(prefix="/api/boards", tags=["boards"])


def not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")


@router.get("", response_model=list[BoardSummary])
def list_boards(user: CurrentUser = Depends(get_current_user)) -> list[BoardSummary]:
    return db.list_boards(user.id)


@router.post("", response_model=BoardSummary, status_code=status.HTTP_201_CREATED)
def create_board(
    payload: CreateBoardRequest, user: CurrentUser = Depends(get_current_user)
) -> BoardSummary:
    return db.create_board(user.id, payload.name, payload.template, payload.data)


@router.get("/{board_id}", response_model=BoardData)
def read_board(board_id: int, user: CurrentUser = Depends(get_current_user)) -> BoardData:
    result = db.get_board(user.id, board_id)
    if result is None:
        raise not_found()
    return result


@router.put("/{board_id}", response_model=BoardData)
def update_board(
    board_id: int, board: BoardData, user: CurrentUser = Depends(get_current_user)
) -> BoardData:
    result = db.save_board(user.id, board_id, board)
    if result is None:
        raise not_found()
    return result


@router.patch("/{board_id}", response_model=BoardSummary)
def rename_board(
    board_id: int, payload: RenameRequest, user: CurrentUser = Depends(get_current_user)
) -> BoardSummary:
    result = db.rename_board(user.id, board_id, payload.name)
    if result is None:
        raise not_found()
    return result


@router.delete("/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_board(board_id: int, user: CurrentUser = Depends(get_current_user)) -> Response:
    if not db.owns_board(user.id, board_id):
        raise not_found()
    if db.count_boards(user.id) <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="You must keep at least one board"
        )
    db.delete_board(user.id, board_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

