import os
from typing import Any
import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import get_current_username

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL = "openai/gpt-oss-120b"

router = APIRouter(prefix="/api/ai", tags=["ai"])


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


@router.post("/test", response_model=AIPromptResponse)
def test_ai_connectivity(
    payload: AIPromptRequest,
    _: str = Depends(get_current_username),
) -> AIPromptResponse:
    reply = ask_openrouter(payload.prompt)
    return AIPromptResponse(reply=reply)
