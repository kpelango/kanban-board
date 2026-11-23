#!/usr/bin/env python3
"""One OpenRouter chat call to openai/gpt-oss-120b, pinned to Cerebras.

Prints the answer to stdout; provider, finish reason, tokens, and cost to stderr.
Standard library only. The API key comes from OPENROUTER_API_KEY or --key-file
and is never printed.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "openai/gpt-oss-120b"


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("prompt", help="the user message")
    p.add_argument("--system", help="system message")
    p.add_argument("--effort", choices=["low", "medium", "high"], default="low", help="reasoning effort (default low)")
    p.add_argument("--max-tokens", type=int, default=4000, help="reasoning + answer budget (default 4000)")
    p.add_argument("--schema", help="JSON file with a JSON Schema; the reply must match it (strict)")
    p.add_argument("--json", action="store_true", help="ask for any valid JSON object")
    p.add_argument("--show-reasoning", action="store_true", help="print the model's reasoning to stderr")
    p.add_argument("--fallback", action="store_true", help="try Cerebras first but allow other providers")
    p.add_argument("--model", default=MODEL, help=f"model slug (default {MODEL})")
    p.add_argument("--key-file", help="file holding the API key (default: OPENROUTER_API_KEY)")
    args = p.parse_args()

    if args.key_file:
        with open(args.key_file) as f:
            key = f.read().strip()
    else:
        key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not key:
        print("No API key: set OPENROUTER_API_KEY or pass --key-file", file=sys.stderr)
        return 2

    messages = []
    if args.system:
        messages.append({"role": "system", "content": args.system})
    messages.append({"role": "user", "content": args.prompt})

    provider = (
        {"order": ["cerebras"], "allow_fallbacks": True, "require_parameters": True}
        if args.fallback
        else {"only": ["cerebras"], "allow_fallbacks": False, "require_parameters": True}
    )
    body = {
        "model": args.model,
        "messages": messages,
        "provider": provider,
        "reasoning": {"effort": args.effort, "exclude": not args.show_reasoning},
        "max_tokens": args.max_tokens,
    }
    if args.schema:
        with open(args.schema) as f:
            schema = json.load(f)
        body["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": "reply", "strict": True, "schema": schema},
        }
    elif args.json:
        body["response_format"] = {"type": "json_object"}

    req = urllib.request.Request(
        URL,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as e:
        try:
            err = json.load(e)["error"]
            print(f"HTTP {e.code}: {err.get('message')}", file=sys.stderr)
            if err.get("metadata", {}).get("available_providers"):
                print(f"Providers serving this model: {', '.join(err['metadata']['available_providers'])}", file=sys.stderr)
        except Exception:
            print(f"HTTP {e.code}", file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print(f"Request failed: {e.reason}", file=sys.stderr)
        return 1

    choice = data["choices"][0]
    message = choice["message"]
    usage = data.get("usage", {})
    reasoning_tokens = usage.get("completion_tokens_details", {}).get("reasoning_tokens")
    if args.show_reasoning and message.get("reasoning"):
        print(f"[reasoning] {message['reasoning']}", file=sys.stderr)
    print(
        f"[provider {data.get('provider')} | finish {choice.get('finish_reason')} | "
        f"tokens in {usage.get('prompt_tokens')} out {usage.get('completion_tokens')} "
        f"(reasoning {reasoning_tokens}) | cost ${usage.get('cost')}]",
        file=sys.stderr,
    )
    content = message.get("content")
    if not content:
        print("No answer: the token budget ran out during reasoning. Raise --max-tokens or lower --effort.", file=sys.stderr)
        return 1
    print(content)
    return 0


if __name__ == "__main__":
    sys.exit(main())
