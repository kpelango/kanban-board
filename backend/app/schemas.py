import copy
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

FIXED_COLUMN_IDS = (
    "col-backlog",
    "col-discovery",
    "col-progress",
    "col-review",
    "col-done",
)

MAX_CARDS = 500

Priority = Literal["none", "low", "medium", "high"]
Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=30)]
Username = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_.-]+$"),
]
Password = Annotated[str, StringConstraints(min_length=8, max_length=128)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class ChecklistItem(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    text: str = Field(min_length=1, max_length=200)
    done: bool = False


class Card(BaseModel):
    id: str = Field(min_length=1, max_length=60)
    title: str = Field(min_length=1, max_length=200)
    details: str = Field(max_length=5000)
    priority: Priority = "none"
    dueDate: date | None = None
    labels: list[Label] = Field(default_factory=list, max_length=10)
    checklist: list[ChecklistItem] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def validate_checklist_ids(self) -> "Card":
        ids = [item.id for item in self.checklist]
        if len(ids) != len(set(ids)):
            raise ValueError(f"Card '{self.id}' has duplicate checklist item ids")
        return self


class Column(BaseModel):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1, max_length=40)
    cardIds: list[str]
    wipLimit: int | None = Field(default=None, ge=1, le=99)


class BoardData(BaseModel):
    columns: list[Column]
    cards: dict[str, Card] = Field(max_length=MAX_CARDS)
    # Archived cards keep their data but leave the columns; the value is the column to restore to
    archived: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_board_integrity(self) -> "BoardData":
        column_ids = [col.id for col in self.columns]
        if tuple(column_ids) != FIXED_COLUMN_IDS:
            raise ValueError(
                f"Columns must match fixed IDs in order: {list(FIXED_COLUMN_IDS)}"
            )

        seen_cards: set[str] = set()
        for col in self.columns:
            for card_id in col.cardIds:
                if card_id not in self.cards:
                    raise ValueError(
                        f"Column '{col.id}' references missing card '{card_id}'"
                    )
                if card_id in seen_cards:
                    raise ValueError(
                        f"Card '{card_id}' appears multiple times across columns"
                    )
                seen_cards.add(card_id)

        for card_id, column_id in self.archived.items():
            if card_id not in self.cards:
                raise ValueError(f"Archived card '{card_id}' is missing from cards")
            if card_id in seen_cards:
                raise ValueError(f"Card '{card_id}' cannot be both archived and in a column")
            if column_id not in FIXED_COLUMN_IDS:
                raise ValueError(f"Archived card '{card_id}' has unknown column '{column_id}'")

        for key, card in self.cards.items():
            if key != card.id:
                raise ValueError(
                    f"Card key '{key}' does not match card.id '{card.id}'"
                )

        return self


# Auth


class Credentials(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: Username
    password: Password


class ChangePasswordRequest(BaseModel):
    currentPassword: str
    newPassword: Password


class DeleteAccountRequest(BaseModel):
    password: str


class UserResponse(BaseModel):
    username: str
    isAdmin: bool = False


class UserSummary(BaseModel):
    id: int
    username: str
    isAdmin: bool
    createdAt: datetime
    boardCount: int


class ResetPasswordRequest(BaseModel):
    newPassword: Password


class SetAdminRequest(BaseModel):
    isAdmin: bool


# Boards


class BoardSummary(BaseModel):
    id: int
    name: str
    cardCount: int
    updatedAt: datetime


class CreateBoardRequest(BaseModel):
    name: Name
    template: Literal["sample", "blank"] = "sample"
    # When given (duplicate or import), the board starts with this data instead of a template
    data: BoardData | None = None


class RenameRequest(BaseModel):
    name: Name


# Conversations


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class ConversationSummary(BaseModel):
    id: int
    boardId: int
    title: str
    updatedAt: datetime


class Conversation(ConversationSummary):
    messages: list[ChatMessage]


class CreateConversationRequest(BaseModel):
    title: Name | None = None


class SendMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


class AIChatStructuredOutput(BaseModel):
    assistant_message: str = Field(min_length=1)
    updated_board: BoardData | None = None


class SendMessageResponse(BaseModel):
    reply: str
    board: BoardData | None = None
    conversation: ConversationSummary


INITIAL_BOARD_DATA: dict = {
    "columns": [
        {"id": "col-backlog", "title": "Backlog", "cardIds": ["card-1", "card-2"]},
        {"id": "col-discovery", "title": "Discovery", "cardIds": ["card-3"]},
        {
            "id": "col-progress",
            "title": "In Progress",
            "cardIds": ["card-4", "card-5"],
        },
        {"id": "col-review", "title": "Review", "cardIds": ["card-6"]},
        {"id": "col-done", "title": "Done", "cardIds": ["card-7", "card-8"]},
    ],
    "cards": {
        "card-1": {
            "id": "card-1",
            "title": "Align roadmap themes",
            "details": "Draft quarterly themes with impact statements and metrics.",
            "priority": "high",
            "labels": ["strategy"],
        },
        "card-2": {
            "id": "card-2",
            "title": "Gather customer signals",
            "details": "Review support tags, sales notes, and churn feedback.",
            "labels": ["research"],
        },
        "card-3": {
            "id": "card-3",
            "title": "Prototype analytics view",
            "details": "Sketch initial dashboard layout and key drill-downs.",
            "priority": "medium",
            "labels": ["design"],
        },
        "card-4": {
            "id": "card-4",
            "title": "Refine status language",
            "details": "Standardize column labels and tone across the board.",
            "priority": "low",
        },
        "card-5": {
            "id": "card-5",
            "title": "Design card layout",
            "details": "Add hierarchy and spacing for scanning dense lists.",
            "priority": "medium",
            "labels": ["design"],
            "checklist": [
                {"id": "item-1", "text": "Pick a type scale", "done": True},
                {"id": "item-2", "text": "Test with dense lists", "done": False},
            ],
        },
        "card-6": {
            "id": "card-6",
            "title": "QA micro-interactions",
            "details": "Verify hover, focus, and loading states.",
            "labels": ["qa"],
        },
        "card-7": {
            "id": "card-7",
            "title": "Ship marketing page",
            "details": "Final copy approved and asset pack delivered.",
        },
        "card-8": {
            "id": "card-8",
            "title": "Close onboarding sprint",
            "details": "Document release notes and share internally.",
        },
    },
}

BLANK_BOARD_DATA: dict = {
    "columns": [
        {**column, "cardIds": []} for column in INITIAL_BOARD_DATA["columns"]
    ],
    "cards": {},
    "archived": {},
}


def board_template(template: str) -> BoardData:
    source = INITIAL_BOARD_DATA if template == "sample" else BLANK_BOARD_DATA
    return BoardData.model_validate(copy.deepcopy(source))
