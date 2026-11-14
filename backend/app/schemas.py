from typing import Literal
from pydantic import BaseModel, Field, model_validator

FIXED_COLUMN_IDS = (
    "col-backlog",
    "col-discovery",
    "col-progress",
    "col-review",
    "col-done",
)


class Card(BaseModel):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    details: str


class Column(BaseModel):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    cardIds: list[str]


class BoardData(BaseModel):
    columns: list[Column]
    cards: dict[str, Card]

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

        for key, card in self.cards.items():
            if key != card.id:
                raise ValueError(
                    f"Card key '{key}' does not match card.id '{card.id}'"
                )

        return self


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    history: list[ChatMessage] = Field(default_factory=list)


class AIChatStructuredOutput(BaseModel):
    assistant_message: str = Field(min_length=1)
    updated_board: BoardData | None = None


class ChatResponse(BaseModel):
    reply: str
    board: BoardData | None = None


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
        },
        "card-2": {
            "id": "card-2",
            "title": "Gather customer signals",
            "details": "Review support tags, sales notes, and churn feedback.",
        },
        "card-3": {
            "id": "card-3",
            "title": "Prototype analytics view",
            "details": "Sketch initial dashboard layout and key drill-downs.",
        },
        "card-4": {
            "id": "card-4",
            "title": "Refine status language",
            "details": "Standardize column labels and tone across the board.",
        },
        "card-5": {
            "id": "card-5",
            "title": "Design card layout",
            "details": "Add hierarchy and spacing for scanning dense lists.",
        },
        "card-6": {
            "id": "card-6",
            "title": "QA micro-interactions",
            "details": "Verify hover, focus, and loading states.",
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
