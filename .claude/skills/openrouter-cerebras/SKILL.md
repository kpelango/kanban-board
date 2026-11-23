---
name: openrouter-cerebras
description: Make LLM calls through the OpenRouter API to OpenAI's open-weight model openai/gpt-oss-120b, served by Cerebras as the inference provider. Covers the exact request body (provider pinning, reasoning effort, max_tokens, JSON and json_schema output), reading the response (content, reasoning, which provider served it, cost), errors, and a ready CLI script for test calls. Use this whenever code or a task calls OpenRouter, gpt-oss, or Cerebras; when adding or changing an AI/LLM call in this project (backend/app/ai.py); when debugging empty or truncated model replies, provider routing, 402/404 errors, or slow AI responses; or when someone wants a quick real model call to test a prompt, even if they don't mention Cerebras by name.
---

# OpenRouter + Cerebras (gpt-oss-120b)

OpenRouter sits in front of many inference providers and, by default, picks one per request and may silently fall back to another. Cerebras runs `openai/gpt-oss-120b` at full precision (fp16) and very fast: a short reply takes about half a second, a full board update under 2 seconds, where other providers took 20 to 45 seconds in testing. Facts here were checked against the live API in November 2026; re-check anything time-sensitive with the endpoints call near the end.

## When to pin, and when to just suggest it

- The task asks for Cerebras (or "fast", "consistent provider"): pin strictly, as below.
- The task is something else in code that calls OpenRouter (a bug fix, a new prompt): fix that, and recommend pinning in your report rather than switching the app's provider on your own. A provider change alters latency, cost, and failure behavior for every user, so it should be the owner's call.

## The request

`POST https://openrouter.ai/api/v1/chat/completions`, header `Authorization: Bearer $OPENROUTER_API_KEY`:

```json
{
  "model": "openai/gpt-oss-120b",
  "messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}],
  "provider": {"only": ["cerebras"], "allow_fallbacks": false, "require_parameters": true},
  "reasoning": {"effort": "low", "exclude": true},
  "max_tokens": 16000
}
```

- `only` + `allow_fallbacks: false` pins to Cerebras. Without `allow_fallbacks: false`, OpenRouter can still move to another provider on a 5xx or rate limit. The trade-off: a Cerebras outage reaches your users as an error.
- `require_parameters: true` makes OpenRouter refuse rather than silently drop a parameter the provider lacks.
- `reasoning.effort` (`low` / `medium` / `high`): gpt-oss always thinks first. Higher is better on multi-step tasks but slower and pricier. `exclude: true` drops the reasoning text from the response (you still pay for it).
- Always set `max_tokens`. Reasoning and answer share it (next section), and without it the provider's default applies; some defaults are large enough (Groq: 65,536) that OpenRouter rejects the request with 402 when the key's remaining credit can't cover the worst case. 16,000 comfortably fits a full JSON board update (about 3,000 tokens including reasoning); Cerebras allows up to 40,960.

Optional headers: `HTTP-Referer` and `X-OpenRouter-Title` (attribution on openrouter.ai only).

## Reading the response

- Answer: `choices[0].message.content`. Reasoning (if not excluded): `message.reasoning`; never show it as the answer.
- Top-level `provider` names who served it (`"Cerebras"`). Assert on it in live tests and log it when fallbacks are allowed.
- `usage.cost` is US dollars; `usage.completion_tokens_details.reasoning_tokens` shows how much went to thinking. The `x-generation-id` header equals `id`, usable with `GET /api/v1/generation?id=<id>`.

## Empty or cut-off replies

If the budget runs out, the response is still HTTP 200 but `finish_reason` is `"length"` and `content` is `null`, empty, or truncated JSON. Live example: `effort: high`, `max_tokens: 30` gave `content: null` with 27 of 30 tokens spent on reasoning. So check `finish_reason` before parsing, give the user a specific message ("ran out of room, ask for less at once"), and fix it with a bigger `max_tokens` or lower effort, not a blind retry.

## JSON output

For a fixed shape use a strict schema (Cerebras enforces it):

```json
"response_format": {"type": "json_schema", "json_schema": {"name": "answer", "strict": true,
  "schema": {"type": "object", "properties": {"answer": {"type": "number"}},
             "required": ["answer"], "additionalProperties": false}}}
```

Strict mode needs every property in `required` and `additionalProperties: false` on every object. `{"type": "json_object"}` only guarantees valid JSON, so state the keys in the prompt and validate the result (this project uses Pydantic). Parse `content` with a real JSON parser either way.

## Errors

| Status | Meaning | Do |
|---|---|---|
| 400 | Bad body (unknown parameter, invalid schema) | Read `error.message`, fix the body |
| 401 | Missing or wrong key | Check `OPENROUTER_API_KEY` |
| 402 | No credit, spend limit hit, or `max_tokens` unset and the provider default exceeds remaining credit | Set `max_tokens`; top up; don't retry |
| 404 "No allowed providers are available" | Cerebras doesn't serve that model (e.g. `openai/gpt-oss-20b`) | `error.metadata.available_providers` lists who does; change the model or the pin |
| 429 | Rate limited | Back off and retry a few times |
| 5xx / timeout | Provider trouble, passed straight through when fallbacks are off | Retry once or twice, then fail clearly |

Errors look like `{"error": {"code": ..., "message": ..., "metadata": {...}}}`.

Cerebras first with backup, if staying up matters more: `"provider": {"order": ["cerebras"], "allow_fallbacks": true, "require_parameters": true}`. Then log `provider`, and keep `max_tokens` within the smallest fallback's cap (some cap at 4,096).

## Code (Python, httpx)

```python
body = {
    "model": "openai/gpt-oss-120b",
    "messages": messages,
    "provider": {"only": ["cerebras"], "allow_fallbacks": False, "require_parameters": True},
    "reasoning": {"effort": "low", "exclude": True},
    "max_tokens": 16000,
}
r = httpx.post("https://openrouter.ai/api/v1/chat/completions",
               headers={"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}"},
               json=body, timeout=45)
r.raise_for_status()
choice = r.json()["choices"][0]
if choice["finish_reason"] == "length" or not (choice["message"].get("content") or "").strip():
    raise RuntimeError("Model ran out of tokens or returned nothing")
content = choice["message"]["content"]
```

With the OpenAI SDK, set `base_url="https://openrouter.ai/api/v1"` and pass `provider` and `reasoning` through `extra_body`.

## Quick test calls

`scripts/openrouter_call.py` (standard library only) makes one pinned call; the answer goes to stdout, provider, finish reason, tokens, and cost to stderr:

```bash
python3 .claude/skills/openrouter-cerebras/scripts/openrouter_call.py --key-file .secrets/openrouter-api-key "What is 2+2?"
#   --system "...", --effort low|medium|high, --max-tokens N, --json, --schema schema.json,
#   --show-reasoning, --fallback (allow other providers), --model <slug>
```

The key comes from `OPENROUTER_API_KEY` or `--key-file`. Each call is real money, usually a fraction of a cent.

## Check what Cerebras serves (no key needed)

```bash
curl -s https://openrouter.ai/api/v1/models/openai/gpt-oss-120b/endpoints | python3 -c '
import json,sys
for e in json.load(sys.stdin)["data"]["endpoints"]:
    if e["provider_name"] == "Cerebras": print(e["tag"], e["max_completion_tokens"], e["pricing"], e["supported_parameters"])'
```

November 2026: `cerebras/fp16`, 131,072 context, 40,960 max completion, $0.35 / $0.75 per million input / output tokens; supports `reasoning`, `max_tokens`, `response_format`, `structured_outputs`, `tools`, `seed`, `temperature` and more. Not `openai/gpt-oss-20b`.

## Secrets

Read the key from the environment or a secrets file; never print it, log it, or put it in code, URLs, or committed files. Pass it with `$(cat file)` or an env var. Keep a spend limit on the key.

## In this project

- `backend/app/ai.py` builds every OpenRouter request in `call_openrouter_messages`; the chat sends `response_format: json_object` and validates the reply with Pydantic.
- Tests fake OpenRouter by monkeypatching `httpx.post`; assert new request keys on the captured payload, and cover `finish_reason: "length"` and empty content. `uv run pytest -m live_ai` makes real calls.
- The key: `.env` locally, `.secrets/openrouter-api-key` for scripts, Vercel env vars when hosted. The app caps assistant messages per account and site-wide (see `AGENTS.md`).
