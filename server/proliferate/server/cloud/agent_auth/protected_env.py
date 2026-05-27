"""Protected environment variable policy for cloud agent auth materialization."""

from __future__ import annotations

from proliferate.constants.cloud import CloudAgentKind

_ALLOWLIST: dict[tuple[str, str], frozenset[str]] = {
    (
        "claude",
        "gateway_env",
    ): frozenset(
        {
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_BASE_URL",
            "ANTHROPIC_CUSTOM_HEADERS",
            "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
        }
    ),
    ("codex", "gateway_env"): frozenset({"CODEX_API_KEY", "CODEX_HOME"}),
    ("opencode", "gateway_env"): frozenset({"OPENAI_API_KEY", "OPENAI_BASE_URL"}),
    ("gemini", "gateway_env"): frozenset({"GEMINI_API_KEY", "GOOGLE_GEMINI_BASE_URL"}),
    ("claude", "synced_files"): frozenset(),
    (
        "gemini",
        "synced_files",
    ): frozenset(
        {
            "GEMINI_API_KEY",
            "GOOGLE_API_KEY",
            "GOOGLE_GENAI_USE_VERTEXAI",
        }
    ),
    ("codex", "synced_files"): frozenset(),
    ("opencode", "synced_files"): frozenset(),
}


def allowed_protected_env_keys(
    *,
    agent_kind: CloudAgentKind | str,
    materialization_mode: str,
) -> frozenset[str]:
    return _ALLOWLIST.get((str(agent_kind), materialization_mode), frozenset())


def reject_unallowed_protected_env(
    *,
    agent_kind: CloudAgentKind | str,
    materialization_mode: str,
    keys: set[str] | frozenset[str],
) -> None:
    allowed = allowed_protected_env_keys(
        agent_kind=agent_kind,
        materialization_mode=materialization_mode,
    )
    extra = sorted(key for key in keys if key not in allowed)
    if extra:
        joined = ", ".join(extra)
        raise ValueError(
            "Protected env contains keys not allowed for "
            f"{agent_kind}/{materialization_mode}: {joined}."
        )
