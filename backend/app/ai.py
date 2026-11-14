import json
import os
import re
from typing import Any
import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, ValidationError

from app.auth import get_current_username
from app.db import get_board_for_user, save_board_for_user
from app.schemas import (
    AIChatStructuredOutput,
    BoardData,
    ChatMessage,
    ChatRequest,
    ChatResponse,
)

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL = "openai/gpt-oss-120b"

router = APIRouter(prefix="/api/ai", tags=["ai"])
chat_router = APIRouter(prefix="/api/chat", tags=["chat"])

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
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Malformed response from OpenRouter",
        ) from exc

    if not isinstance(content, str):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Empty content from OpenRouter",
        )
    return content.strip()


def ask_openrouter(prompt: str) -> str:
    return call_openrouter_messages([{"role": "user", "content": prompt}])


def build_kanban_system_prompt(board: BoardData) -> str:
    board_json = json.dumps(board.model_dump(), indent=2)
    return (
        "You are an intelligent project management assistant for Kanban Studio.\n"
        "You have full visibility into the user's current Kanban board JSON and can answer questions or modify the board when requested.\n\n"
        "Board rules:\n"
        "1. The board always has exactly 5 columns in this exact order and with these exact IDs: "
        "'col-backlog', 'col-discovery', 'col-progress', 'col-review', 'col-done'.\n"
        "2. Columns can have their 'title' renamed, and their 'cardIds' array reordered or updated, "
        "but columns cannot be added, deleted, or have their 'id' changed.\n"
        "3. Every ID in any column's 'cardIds' list must exist as a key in the 'cards' object with a matching 'id' property.\n"
        "4. No card ID may appear in more than one column.\n"
        "5. When creating a new card, generate a unique ID like 'card-9', 'card-10', etc., add the Card object "
        "({'id': '...', 'title': '...', 'details': '...'}) to 'cards', and append its ID to the target column's 'cardIds'.\n"
        "6. When deleting a card, remove its ID from the column's 'cardIds' and remove its entry from 'cards'.\n\n"
        "You MUST respond strictly with a single valid JSON object (no markdown fences, no extra text) matching this exact schema:\n"
        "{\n"
        '  "assistant_message": "Your concise, helpful reply to the user",\n'
        '  "updated_board": null // OR the complete updated BoardData object {"columns": [...], "cards": {...}} if and only if the board should be modified\n'
        "}\n\n"
        "If the user is only asking a question or chatting without requesting a board change, set \"updated_board\" to null.\n"
        "If the user asks to create, edit, move, reorder, or delete cards, or rename a column, return the full updated board in \"updated_board\".\n\n"
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
    _: str = Depends(get_current_username),
) -> AIPromptResponse:
    reply = ask_openrouter(payload.prompt)
    return AIPromptResponse(reply=reply)


@chat_router.post("", response_model=ChatResponse)
def chat_with_ai(
    payload: ChatRequest,
    username: str = Depends(get_current_username),
) -> ChatResponse:
    current_board = get_board_for_user(username)
    ai_output = run_kanban_chat(
        board=current_board,
        message=payload.message,
        history=payload.history,
    )
    if ai_output.updated_board is not None:
        save_board_for_user(username, ai_output.updated_board)
    return ChatResponse(
        reply=ai_output.assistant_message,
        board=ai_output.updated_board,
    )

