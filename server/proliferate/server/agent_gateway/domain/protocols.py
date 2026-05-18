"""Pure protocol/model rules for the agent gateway."""

from __future__ import annotations

import json
from collections.abc import Mapping
from urllib.parse import parse_qsl, urlencode


def protocol_for_path(path: str) -> str:
    if "/anthropic/" in path:
        return "anthropic"
    if "/openai/" in path:
        return "openai"
    return "unknown"


def litellm_path_for_gateway_path(path: str) -> str:
    if "/anthropic" in path:
        return path[path.index("/anthropic") :].removeprefix("/anthropic")
    if "/openai" in path:
        return path[path.index("/openai") :].removeprefix("/openai")
    return path


def litellm_query_string_for_gateway_request(path: str, query_string: str) -> str:
    if not query_string or protocol_for_path(path) != "anthropic":
        return query_string
    params = [
        (key, value)
        for key, value in parse_qsl(query_string, keep_blank_values=True)
        if not (key.lower() == "beta" and value.lower() == "true")
    ]
    return urlencode(params)


def litellm_protocol_headers_for_gateway_request(
    path: str,
    protocol_headers: Mapping[str, str],
) -> dict[str, str]:
    if protocol_for_path(path) != "anthropic":
        return dict(protocol_headers)
    return {
        key: value for key, value in protocol_headers.items() if key.lower() != "anthropic-beta"
    }


def litellm_body_for_gateway_request(
    path: str,
    body_json: Mapping[str, object],
    body: bytes,
) -> bytes:
    if protocol_for_path(path) != "anthropic" or "context_management" not in body_json:
        return body
    normalized = dict(body_json)
    normalized.pop("context_management", None)
    return json.dumps(normalized, separators=(",", ":")).encode("utf-8")


def model_from_body(body: Mapping[str, object]) -> str | None:
    model = body.get("model")
    return model if isinstance(model, str) and model else None


def request_wants_stream(body: Mapping[str, object]) -> bool:
    return body.get("stream") is True


def allowed_models_for_agent(agent_kind: str) -> tuple[str, ...]:
    if agent_kind == "claude":
        return ("us.anthropic.claude-sonnet-4-6",)
    if agent_kind == "codex":
        return ("gpt-5.5",)
    if agent_kind == "opencode":
        return ("opencode/big-pickle",)
    return ()
