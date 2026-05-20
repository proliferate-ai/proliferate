"""Pure protocol/model rules for the agent gateway."""

from __future__ import annotations

from collections.abc import Mapping


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
