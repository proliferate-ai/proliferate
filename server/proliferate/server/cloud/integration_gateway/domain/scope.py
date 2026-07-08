"""Pure two-layer gateway scope enforcement (spec 6.4/6.6/6.7, L25).

This module is deliberately free of FastAPI, DB, and HTTP: it is a set of pure
functions over plain data so the *same* authorization runs for a sandbox agent's
``tools/call`` today AND for a future server-side ``function_call`` performer
(§6.6/L18/L23) — the gateway checks scope, not caller location.

Two layers, both re-checked on every request (L25 is asymmetric: mint decides what
*may* be requested, request time re-checks the live worker allowlist):

* ``run_scope`` — layer 2, the per-run token's frozen grant. E3: NAMESPACE-LEVEL.
  Shape ``[{"provider": str}, ...]`` — a **namespace-only** entry (no ``tools``
  key) grants EVERY tool of that provider (the definition stores namespaces, not
  tool lists). An entry MAY still carry an explicit ``"tools": [str, ...]`` list to
  restrict to those tools — reserved for future per-slot narrowing (Part II); the
  core-v1 resolver never emits it. ``None`` means the caller is a per-worker token,
  which carries no per-run restriction. A list (even an empty one) means a run
  token: a provider must appear in it, and an empty list grants nothing — never
  conflated with ``None``.
* ``worker_scope`` — layer 1, the delivering worker's provider-namespace
  allowlist. ``None`` means unscoped (today's behavior). A list is an allowlist of
  provider namespaces (an empty list grants nothing).
"""

from __future__ import annotations

from dataclasses import dataclass

# Enumerated deny reasons (agent-readable, never a 500 — surfaced through the
# gateway's existing MCP error-result envelope).
SCOPE_DENY_PROVIDER_OUT_OF_WORKER = "provider_out_of_worker_scope"
SCOPE_DENY_PROVIDER_OUT_OF_RUN = "provider_out_of_run_scope"
SCOPE_DENY_TOOL_OUT_OF_RUN = "tool_out_of_run_scope"


@dataclass(frozen=True)
class ScopeDecision:
    allowed: bool
    reason: str | None = None
    detail: str | None = None


def _run_scope_entry(
    run_scope: list[dict[str, object]], provider: str
) -> dict[str, object] | None:
    for entry in run_scope:
        if isinstance(entry, dict) and entry.get("provider") == provider:
            return entry
    return None


def _entry_grants_all_tools(entry: dict[str, object]) -> bool:
    """E3: a namespace-only entry (no explicit ``tools`` list) grants every tool."""

    return not isinstance(entry.get("tools"), list)


def _tools_of(entry: dict[str, object]) -> set[str]:
    tools = entry.get("tools")
    if not isinstance(tools, list):
        return set()
    return {tool for tool in tools if isinstance(tool, str)}


def worker_allows_provider(worker_scope: list[str] | None, provider: str) -> bool:
    """Layer 1: NULL worker scope = unscoped passthrough; a list is an allowlist."""

    if worker_scope is None:
        return True
    return provider in worker_scope


def providers_in_run_scope(run_scope: list[dict[str, object]] | None) -> set[str] | None:
    """The providers a run token may reach, or ``None`` for a worker-token grant."""

    if run_scope is None:
        return None
    return {
        str(entry["provider"])
        for entry in run_scope
        if isinstance(entry, dict) and isinstance(entry.get("provider"), str)
    }


def authorize_tool_call(
    *,
    run_scope: list[dict[str, object]] | None,
    worker_scope: list[str] | None,
    provider: str,
    tool: str,
) -> ScopeDecision:
    """Allow/deny a single ``(provider, tool)`` against both layers."""

    if not worker_allows_provider(worker_scope, provider):
        return ScopeDecision(
            allowed=False,
            reason=SCOPE_DENY_PROVIDER_OUT_OF_WORKER,
            detail=(
                f"Provider '{provider}' is not in this worker's integration allowlist."
            ),
        )
    if run_scope is not None:
        entry = _run_scope_entry(run_scope, provider)
        if entry is None:
            return ScopeDecision(
                allowed=False,
                reason=SCOPE_DENY_PROVIDER_OUT_OF_RUN,
                detail=(
                    f"Provider '{provider}' is not granted to this run. "
                    f"Granted providers: {sorted(providers_in_run_scope(run_scope) or set())}."
                ),
            )
        # E3: a namespace-only grant reaches EVERY tool of the provider — no
        # per-tool check. (An explicit tools list, reserved for future per-slot
        # narrowing, still restricts.)
        if not _entry_grants_all_tools(entry):
            granted = _tools_of(entry)
            if tool not in granted:
                return ScopeDecision(
                    allowed=False,
                    reason=SCOPE_DENY_TOOL_OUT_OF_RUN,
                    detail=(
                        f"Tool '{tool}' on provider '{provider}' is not granted to this run. "
                        f"Granted tools: {sorted(granted)}."
                    ),
                )
    return ScopeDecision(allowed=True)


def filter_tools_to_scope(
    *,
    run_scope: list[dict[str, object]] | None,
    worker_scope: list[str] | None,
    provider: str,
    tools: list[dict[str, object]],
) -> list[dict[str, object]]:
    """Filter an upstream ``tools/list`` result down to what the caller may call.

    Each tool dict is expected to carry a ``name``; unnamed entries are dropped.
    """

    kept: list[dict[str, object]] = []
    for tool in tools:
        name = tool.get("name") if isinstance(tool, dict) else None
        if not isinstance(name, str):
            continue
        if authorize_tool_call(
            run_scope=run_scope, worker_scope=worker_scope, provider=provider, tool=name
        ).allowed:
            kept.append(tool)
    return kept


def provider_visible(
    *,
    run_scope: list[dict[str, object]] | None,
    worker_scope: list[str] | None,
    provider: str,
) -> bool:
    """Whether a provider should appear in ``list_providers`` for this caller.

    A provider is visible when the worker allows it AND (for a run token) it has a
    granted entry. Worker-token grants only apply the worker layer.
    """

    if not worker_allows_provider(worker_scope, provider):
        return False
    if run_scope is None:
        return True
    return _run_scope_entry(run_scope, provider) is not None


def intersect_namespaces_with_worker(
    namespaces: list[str],
    worker_scope: list[str] | None,
) -> list[str]:
    """L25 delivery re-freeze at NAMESPACE granularity (E3).

    ``worker_scope`` NULL = unscoped passthrough (namespaces unchanged, distinct
    from an empty allowlist which drops every namespace). Order preserved.
    """

    if worker_scope is None:
        return list(namespaces)
    allowed = set(worker_scope)
    return [ns for ns in namespaces if ns in allowed]


def intersect_run_scope_with_worker(
    run_scope: list[dict[str, object]],
    worker_scope: list[str] | None,
) -> list[dict[str, object]]:
    """L25 delivery re-freeze: narrow a run scope to the delivering worker's allowlist.

    ``worker_scope`` NULL = unscoped passthrough (run scope unchanged, distinct from
    an empty allowlist which drops every provider). Tools are not narrowed here —
    the worker layer is provider-level.
    """

    if worker_scope is None:
        return list(run_scope)
    allowed = set(worker_scope)
    return [
        entry
        for entry in run_scope
        if isinstance(entry, dict) and entry.get("provider") in allowed
    ]
