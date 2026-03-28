from __future__ import annotations

import json
import os
import re
import ssl
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def load_dotenv_if_present(path: Path | None = None) -> None:
    path = path or Path(".env")
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def provider_for_model(model: str) -> str:
    if model.startswith("gpt-"):
        return "openai"
    if model.startswith("claude-"):
        return "anthropic"
    raise ValueError(f"Unknown provider for model: {model}")


def _json_request(
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
    insecure_ssl: bool = False,
) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    max_attempts = int(os.environ.get("AGENTHUNT_LLM_MAX_ATTEMPTS", "6"))
    base_sleep = float(os.environ.get("AGENTHUNT_LLM_RETRY_BASE_SECONDS", "2.0"))
    inter_call_sleep = float(os.environ.get("AGENTHUNT_LLM_SLEEP_SECONDS", "0.35"))
    last_err: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("content-type", "application/json")
        for key, value in headers.items():
            req.add_header(key, value)
        context = ssl._create_unverified_context() if insecure_ssl else None
        try:
            with urllib.request.urlopen(req, timeout=60, context=context) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                if inter_call_sleep > 0:
                    time.sleep(inter_call_sleep)
                return body
        except urllib.error.HTTPError as exc:
            last_err = exc
            if exc.code == 429 and attempt < max_attempts:
                retry_after = exc.headers.get("retry-after")
                if retry_after:
                    sleep_seconds = float(retry_after)
                else:
                    sleep_seconds = base_sleep * (2 ** (attempt - 1))
                time.sleep(sleep_seconds)
                continue
            raise
        except Exception as exc:  # pragma: no cover
            last_err = exc
            if attempt < max_attempts:
                time.sleep(base_sleep * (2 ** (attempt - 1)))
                continue
            raise
    if last_err:
        raise last_err
    raise RuntimeError("LLM request failed without explicit exception")


def call_openai_chat(
    model: str,
    system_prompt: str,
    user_prompt: str,
    insecure_ssl: bool = False,
) -> dict[str, Any]:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is missing")
    payload = {
        "model": model,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    result = _json_request(
        "https://api.openai.com/v1/chat/completions",
        payload,
        {"Authorization": f"Bearer {api_key}"},
        insecure_ssl=insecure_ssl,
    )
    content = result["choices"][0]["message"]["content"]
    parsed = json.loads(content)
    parsed["_usage"] = result.get("usage", {})
    return parsed


def call_anthropic_messages(
    model: str,
    system_prompt: str,
    user_prompt: str,
    insecure_ssl: bool = False,
) -> dict[str, Any]:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is missing")
    payload = {
        "model": model,
        "max_tokens": 300,
        "temperature": 0.2,
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": user_prompt},
        ],
    }
    result = _json_request(
        "https://api.anthropic.com/v1/messages",
        payload,
        {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        insecure_ssl=insecure_ssl,
    )
    text = "".join(block.get("text", "") for block in result.get("content", []) if block.get("type") == "text")
    parsed = _parse_json_from_text(text)
    parsed["_usage"] = result.get("usage", {})
    return parsed


def _parse_json_from_text(text: str) -> dict[str, Any]:
    text = text.strip()
    if not text:
        raise ValueError("Empty model response")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, flags=re.S)
    if match:
        return json.loads(match.group(0))
    raise ValueError(f"Could not parse JSON from model output: {text[:200]}")


def call_llm_json(
    model: str,
    system_prompt: str,
    user_prompt: str,
    insecure_ssl: bool = False,
) -> dict[str, Any]:
    provider = provider_for_model(model)
    if provider == "openai":
        return call_openai_chat(model, system_prompt, user_prompt, insecure_ssl=insecure_ssl)
    return call_anthropic_messages(model, system_prompt, user_prompt, insecure_ssl=insecure_ssl)
