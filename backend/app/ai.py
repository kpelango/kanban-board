import json
import os
import re
from datetime import date
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, ValidationError

from app import db
from app.admin import require_admin
from app.auth import CurrentUser, get_current_user
from app.board import not_found as board_not_found
from app.schemas import (
    AIChatStructuredOutput,
    BoardData,
    ChatMessage,
    Conversation,
    ConversationSummary,
    CreateConversationRequest,
    RenameRequest,
    SendMessageRequest,
    SendMessageResponse,
)

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL = "openai/gpt-oss-120b"
# Pinned to Cerebras with no fallback: unpinned, OpenRouter may route to providers whose
# completion cap is as low as 4096 tokens (and some take 45 s+), which big planning replies exceed.
OPENROUTER_PROVIDER: dict[str, Any] = {
    "only": ["cerebras"],
    "allow_fallbacks": False,
    "require_parameters": True,
}
# gpt-oss always reasons first and those tokens count toward max_tokens. A full board update
# is about 3,000 tokens including reasoning, so 16,000 leaves room for large plans
# (Cerebras allows up to 40,960). The reasoning text itself is not needed, so it is excluded.
OPENROUTER_REASONING: dict[str, Any] = {"effort": "medium", "exclude": True}
OPENROUTER_MAX_TOKENS = 16000

router = APIRouter(prefix="/api/ai", tags=["ai"])
board_conversations_router = APIRouter(
    prefix="/api/boards/{board_id}/conversations", tags=["conversations"]
)
conversations_router = APIRouter(prefix="/api/conversations", tags=["conversations"])
MAX_HISTORY_MESSAGES = 20
# Assistant messages per rolling 24 hours, overridable by these environment variables.
# The total covers all accounts together, so creating new accounts cannot run up the bill.
AI_LIMIT_DEFAULTS = {"AI_DAILY_LIMIT": 30, "AI_DAILY_LIMIT_GUEST": 10, "AI_DAILY_LIMIT_TOTAL": 500}

KANBAN_RESPONSE_FORMAT: dict[str, Any] = {
    "type": "json_object",
}


class AIPromptRequest(BaseModel):
    prompt: str = Field(min_length=1)


class AIPromptResponse(BaseModel):
    reply: str
    model: str = OPENROUTER_MODEL


def get_openrouter_api_key() -> str:
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OPENROUTER_API_KEY is not configured",
        )
    return api_key


def call_openrouter_messages(
    messages: list[dict[str, str]],
    response_format: dict[str, Any] | None = None,
    timeout: float = 45.0,
) -> str:
    api_key = get_openrouter_api_key()
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload: dict[str, Any] = {
        "model": OPENROUTER_MODEL,
        "messages": messages,
        "provider": OPENROUTER_PROVIDER,
        "reasoning": OPENROUTER_REASONING,
        "max_tokens": OPENROUTER_MAX_TOKENS,
    }
    if response_format is not None:
        payload["response_format"] = response_format

    try:
        response = httpx.post(
            OPENROUTER_API_URL,
            headers=headers,
            json=payload,
            timeout=timeout,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenRouter returned status {exc.response.status_code}",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to connect to OpenRouter",
        ) from exc

    data = response.json()
    try:
        choice = data["choices"][0]
        content = choice["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Malformed response from OpenRouter",
        ) from exc

    # finish_reason "length" means the token budget ran out (often entirely on reasoning),
    # leaving the answer missing or cut off mid-JSON. Retrying the same request will not help.
    if choice.get("finish_reason") == "length":
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The assistant ran out of room before finishing its reply. "
            "Try asking for a smaller change at a time.",
        )
    if not isinstance(content, str) or not content.strip():
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The assistant returned an empty reply. Please try again.",
        )
    return content.strip()


def ask_openrouter(prompt: str) -> str:
    return call_openrouter_messages([{"role": "user", "content": prompt}])


def build_kanban_system_prompt(board: BoardData) -> str:
    board_json = board.model_dump_json()
    return (
        "You are an intelligent project management assistant for Kanban Studio.\n"
        "You have full visibility into the user's current Kanban board JSON and can answer questions or modify the board when requested.\n"
        f"Today's date is {date.today().isoformat()}.\n\n"
        "Board rules:\n"
        "1. The board always has exactly 5 columns in this exact order and with these exact IDs: "
        "'col-backlog', 'col-discovery', 'col-progress', 'col-review', 'col-done'.\n"
        "2. Columns can have their 'title' renamed, their 'wipLimit' (work-in-progress limit, integer 1-99 or null) set, and their 'cardIds' array reordered or updated, "
        "but columns cannot be added, deleted, or have their 'id' changed.\n"
        "3. Every ID in any column's 'cardIds' list must exist as a key in the 'cards' object with a matching 'id' property.\n"
        "4. No card ID may appear in more than one column.\n"
        "5. A card is {'id', 'title', 'details', 'priority', 'dueDate', 'labels', 'checklist'}: 'priority' is one of 'none', 'low', 'medium', 'high'; "
        "'dueDate' is 'YYYY-MM-DD' or null; 'labels' is a list of short lowercase strings (max 10); "
        "'checklist' is a list of subtasks {'id': 'item-1', 'text': '...', 'done': false} (max 50, ids unique within the card).\n"
        "6. When creating a new card, generate a unique ID like 'card-9', 'card-10', etc. that is not already used, add the Card object "
        "to 'cards', and append its ID to the target column's 'cardIds'.\n"
        "7. When deleting a card, remove its ID from the column's 'cardIds' and remove its entry from 'cards'.\n"
        "8. 'archived' maps archived card IDs to the column they came from. Archived cards stay in 'cards' but are in no column's 'cardIds'. "
        "To archive a card, remove it from its column and add it to 'archived'; to restore one, remove it from 'archived' and append it to that column. "
        "Ignore archived cards when describing the board unless the user asks about them.\n"
        "9. Preserve every card and field you were not asked to change.\n\n"
        "You MUST respond strictly with a single valid JSON object (no markdown fences, no extra text) matching this exact schema:\n"
        "{\n"
        '  "assistant_message": "Your concise, helpful reply to the user",\n'
        '  "updated_board": null // OR the complete updated BoardData object {"columns": [...], "cards": {...}} if and only if the board should be modified\n'
        "}\n\n"
        "If the user is only asking a question or chatting without requesting a board change, set \"updated_board\" to null.\n"
        "If the user asks to create, edit, move, reorder, or delete cards, or change columns, return the full updated board in \"updated_board\".\n\n"
        f"Current Kanban Board JSON:\n{board_json}"
    )


def parse_structured_ai_output(raw_content: str) -> AIChatStructuredOutput:
    cleaned = raw_content.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        parsed = json.loads(cleaned)
        return AIChatStructuredOutput.model_validate(parsed)
    except (json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Invalid structured output from AI: {exc}",
        ) from exc


def run_kanban_chat(
    board: BoardData,
    message: str,
    history: list[ChatMessage],
) -> AIChatStructuredOutput:
    messages: list[dict[str, str]] = [
        {"role": "system", "content": build_kanban_system_prompt(board)}
    ]
    for item in history:
        messages.append({"role": item.role, "content": item.content})
    messages.append({"role": "user", "content": message})

    raw_reply = call_openrouter_messages(
        messages=messages,
        response_format=KANBAN_RESPONSE_FORMAT,
    )
    return parse_structured_ai_output(raw_reply)


@router.post("/test", response_model=AIPromptResponse)
def test_ai_connectivity(
    payload: AIPromptRequest,
    _: CurrentUser = Depends(require_admin),  # bypasses the daily limit, so admins only
) -> AIPromptResponse:
    return AIPromptResponse(reply=ask_openrouter(payload.prompt))


def ai_limit(name: str) -> int:
    value = os.getenv(name, str(AI_LIMIT_DEFAULTS[name]))
    if not value.isdigit():
        raise RuntimeError(f"{name} must be a whole number, not {value!r}")
    return int(value)


def check_ai_limits() -> None:
    """Called at startup so a mistyped limit fails the deploy instead of the first chat."""
    for name in AI_LIMIT_DEFAULTS:
        ai_limit(name)


def conversation_not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")


@board_conversations_router.get("", response_model=list[ConversationSummary])
def list_conversations(
    board_id: int, user: CurrentUser = Depends(get_current_user)
) -> list[ConversationSummary]:
    result = db.list_conversations(user.id, board_id)
    if result is None:
        raise board_not_found()
    return result


@board_conversations_router.post(
    "", response_model=ConversationSummary, status_code=status.HTTP_201_CREATED
)
def create_conversation(
    board_id: int,
    payload: CreateConversationRequest,
    user: CurrentUser = Depends(get_current_user),
) -> ConversationSummary:
    result = db.create_conversation(user.id, board_id, payload.title)
    if result is None:
        raise board_not_found()
    return result


@conversations_router.get("/{conversation_id}", response_model=Conversation)
def read_conversation(
    conversation_id: int, user: CurrentUser = Depends(get_current_user)
) -> Conversation:
    summary = db.get_conversation(user.id, conversation_id)
    if summary is None:
        raise conversation_not_found()
    return Conversation(**summary.model_dump(), messages=db.get_messages(conversation_id))


@conversations_router.patch("/{conversation_id}", response_model=ConversationSummary)
def rename_conversation(
    conversation_id: int,
    payload: RenameRequest,
    user: CurrentUser = Depends(get_current_user),
) -> ConversationSummary:
    result = db.rename_conversation(user.id, conversation_id, payload.name)
    if result is None:
        raise conversation_not_found()
    return result


@conversations_router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(
    conversation_id: int, user: CurrentUser = Depends(get_current_user)
) -> Response:
    if not db.delete_conversation(user.id, conversation_id):
        raise conversation_not_found()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@conversations_router.post("/{conversation_id}/messages", response_model=SendMessageResponse)
def send_message(
    conversation_id: int,
    payload: SendMessageRequest,
    user: CurrentUser = Depends(get_current_user),
) -> SendMessageResponse:
    conversation = db.get_conversation(user.id, conversation_id)
    if conversation is None:
        raise conversation_not_found()
    limit = ai_limit("AI_DAILY_LIMIT_GUEST" if user.is_guest else "AI_DAILY_LIMIT")
    reached = db.try_consume_ai_quota(user.id, limit, ai_limit("AI_DAILY_LIMIT_TOTAL"))
    if reached:
        detail = (
            f"You have used all {limit} assistant messages for today. Try again tomorrow."
            if reached == "user"
            else "The assistant has reached today's limit for this demo. Try again tomorrow."
        )
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=detail)
    board = db.get_board(user.id, conversation.boardId)
    history = db.get_messages(conversation_id, limit=MAX_HISTORY_MESSAGES)
    ai_output = run_kanban_chat(board=board, message=payload.message, history=history)
    if ai_output.updated_board is not None:
        db.save_board(user.id, conversation.boardId, ai_output.updated_board)
    new_title = None
    if not history and conversation.title == db.DEFAULT_CONVERSATION_TITLE:
        new_title = payload.message.strip()[:60]
    summary = db.append_messages(
        conversation_id,
        [
            ChatMessage(role="user", content=payload.message),
            ChatMessage(role="assistant", content=ai_output.assistant_message),
        ],
        title=new_title,
    )
    return SendMessageResponse(
        reply=ai_output.assistant_message,
        board=ai_output.updated_board,
        conversation=summary,
    )
