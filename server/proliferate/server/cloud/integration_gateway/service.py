"""Integration gateway JSON-RPC service.

Resolves the gateway grant to its owner, exposes that owner's ready
integration accounts as three virtual MCP tools, and proxies tool calls to the
upstream MCP with Cloud-held credentials. Provider credentials never leave
Cloud; AnyHarness only ever holds the gateway bearer token.
"""

from __future__ import annotations

import json
import time
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import FUNCTION_INVOCATION_PROVIDER_NAMESPACE
from proliferate.db.store import function_invocations as invocations_store
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import policies as policies_store
from proliferate.db.store.integrations import tool_call_events as tool_call_events_store
from proliferate.db.store.integrations.accounts import ReadyAccountRow
from proliferate.db.store.runtime_workers import IntegrationGatewayGrant
from proliferate.integrations import mcp_remote
from proliferate.integrations.mcp_remote import McpRemoteError
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integration_gateway import functions as functions_dispatch
from proliferate.server.cloud.integration_gateway.domain import json_rpc, scope, virtual_tools
from proliferate.server.cloud.integration_gateway.domain.tool_args import (
    parse_call_tool_args,
    parse_list_tools_args,
)
from proliferate.server.cloud.integration_gateway.models import GatewayProviderAccount
from proliferate.server.cloud.integrations.access import resolve_launch
from proliferate.server.cloud.integrations.tools import get_or_refresh_tool_cache
from proliferate.server.cloud.workflows import capability_authz

_PROTOCOL_VERSION = "2025-06-18"


def _org_allows(grant: IntegrationGatewayGrant, row: ReadyAccountRow) -> bool:
    """Whether the grant's org policy overlay leaves this definition enabled.

    Org-scoped grants get the org overlay: an explicit policy row wins,
    otherwise the definition's default. Org-less grants (``organization_id``
    NULL) see seeds-with-defaults behavior — no overlay at all. That org-less
    escape hatch is a documented v1 tradeoff (see
    ``create_desktop_enrollment``): enrollment never forces an org, so the
    overlay governs org-scoped workers rather than hard-blocking members who
    enroll org-less.
    """
    if grant.organization_id is None:
        return True
    if row.org_policy_enabled is not None:
        return row.org_policy_enabled
    return row.definition.enabled_by_default


async def ready_accounts_for_grant(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
) -> list[GatewayProviderAccount]:
    """The owner's enabled, ready accounts whose definition is not archived.

    For org-scoped grants, definitions disabled by the org policy overlay are
    excluded.
    """
    rows = await accounts_store.list_ready_accounts_for_user(
        db, grant.owner_user_id, organization_id=grant.organization_id
    )
    return [
        GatewayProviderAccount(account=row.account, definition=row.definition)
        for row in rows
        if _org_allows(grant, row)
    ]


async def build_chat_default_access_scope(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    organization_id: UUID | None,
) -> list[dict[str, object]] | None:
    """Compute the CHAT/interactive default-access run-scope for a per-worker grant.

    Wires ``CloudIntegrationPolicy.scope_json`` (§2 "default access modes") into the
    interactive gateway path so a chat session gets a CONFIGURABLE default set of
    integrations instead of unconditionally ALL of the owner's ready ones.

    Returns a ``run_scope``-shaped allowlist (``[{"provider": ns}, ...]`` or
    ``{"provider": ns, "tools": [...]}`` for a per-integration tool restriction), or
    ``None`` when the org authored no restriction — **default-all**, i.e. today's
    unconditional behavior (all ready integrations, all tools).

    Per-integration default access modes (each definition's policy ``scope_json``):
      * NULL / absent -> integration in the default set with ALL tools
      * ``[]``        -> integration EXCLUDED from the chat default set
      * ``[tool]``    -> integration restricted to those tools

    **default-subset** = the org authored ≥1 restriction: an allowlist is built over
    the owner's ready integrations honoring each per-integration mode.

    Workflows are unaffected: run-token grants carry their own frozen ``run_scope``
    (E3 explicit opt-in) and never call this.
    """
    restrictions = (
        await policies_store.list_authored_scope_restrictions(db, organization_id)
        if organization_id is not None
        else {}
    )
    # Function invocations default WORKFLOW-ONLY: a chat session may only reach the
    # ones the owner explicitly enabled for chat (``chat_scope_enabled``). If the
    # owner has any invocations at all, the chat default scope MUST be explicit so
    # non-enabled ones are locked out — returning None (default-all) would open
    # every invocation to every chat session (§11 ordering constraint).
    invocations = await invocations_store.list_for_owner(db, owner_user_id)
    chat_invocation_names = [inv.name for inv in invocations if inv.chat_scope_enabled]

    if not restrictions and not invocations:
        return None  # default-all: no integration restriction, no invocations to lock

    # `list_ready_accounts_for_user` already joins the (non-archived) definition
    # and the org-policy overlay into each row (main's ReadyAccountRow), so the
    # definition rides the row — no separate get_definitions_by_ids fetch.
    rows = await accounts_store.list_ready_accounts_for_user(
        db, owner_user_id, organization_id=organization_id
    )
    scope_entries: list[dict[str, object]] = []
    seen: set[str] = set()
    for row in rows:
        definition = row.definition
        if definition.archived_at is not None:
            continue
        if definition.namespace in seen:
            continue
        seen.add(definition.namespace)
        allowed = restrictions.get(definition.id)
        if allowed is None:
            scope_entries.append({"provider": definition.namespace})
        elif len(allowed) == 0:
            continue  # excluded from the chat default set
        else:
            scope_entries.append({"provider": definition.namespace, "tools": list(allowed)})
    # The reserved ``functions`` provider is added to the chat default set only if
    # ≥1 invocation is chat-enabled, restricted to exactly those names; a non-enabled
    # invocation is therefore absent from the scope and denied at the gateway.
    if chat_invocation_names:
        scope_entries.append(
            {
                "provider": FUNCTION_INVOCATION_PROVIDER_NAMESPACE,
                "tools": chat_invocation_names,
            }
        )
    return scope_entries


async def account_for_provider(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
    provider: str,
) -> GatewayProviderAccount:
    row = await accounts_store.get_ready_account_for_provider(
        db, grant.owner_user_id, provider, organization_id=grant.organization_id
    )
    if row is None:
        raise CloudApiError(
            "integration_provider_not_found",
            f"No connected integration provider '{provider}'.",
            status_code=404,
        )
    if not _org_allows(grant, row):
        raise CloudApiError(
            "integration_provider_disabled",
            f"Integration provider '{provider}' is disabled by your organization's policy.",
            status_code=404,
        )
    return GatewayProviderAccount(account=row.account, definition=row.definition)


async def list_providers(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
) -> dict[str, object]:
    # Scope filtering (§6.3, least astonishment): a caller only *sees* the
    # providers its grant reaches. Worker-token grants apply only the worker layer;
    # run-token grants also hide providers outside the frozen run scope.
    providers = [
        {
            "provider": pair.definition.namespace,
            "displayName": pair.definition.display_name,
            "authKind": pair.definition.auth_kind,
            "status": pair.account.status,
        }
        for pair in await ready_accounts_for_grant(db, grant=grant)
        if scope.provider_visible(
            run_scope=grant.effective_run_scope,
            worker_scope=grant.worker_scope,
            provider=pair.definition.namespace,
        )
    ]
    # The reserved ``functions`` virtual provider: visible when the owner has ≥1
    # live invocation AND the caller's scope reaches the ``functions`` namespace
    # (chat: only if an invocation is chat-enabled; workflow: only if granted).
    invocations = await invocations_store.list_for_owner(db, grant.owner_user_id)
    if invocations and scope.provider_visible(
        run_scope=grant.effective_run_scope,
        worker_scope=grant.worker_scope,
        provider=FUNCTION_INVOCATION_PROVIDER_NAMESPACE,
    ):
        providers.append(
            {
                "provider": FUNCTION_INVOCATION_PROVIDER_NAMESPACE,
                "displayName": "Functions",
                "authKind": "none",
                "status": "ready",
            }
        )
    return {"providers": providers}


async def list_tools_for_provider(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
    provider: str,
) -> dict[str, object]:
    if provider == FUNCTION_INVOCATION_PROVIDER_NAMESPACE:
        invocations = await invocations_store.list_for_owner(db, grant.owner_user_id)
        tools = [
            {
                "name": inv.name,
                "description": inv.description or inv.display_name or inv.name,
                "inputSchema": inv.args_schema_json
                or {"type": "object", "additionalProperties": True},
            }
            for inv in invocations
        ]
        filtered = scope.filter_tools_to_scope(
            run_scope=grant.effective_run_scope,
            worker_scope=grant.worker_scope,
            provider=provider,
            tools=tools,
        )
        return {"provider": provider, "tools": filtered}
    pair = await account_for_provider(db, grant=grant, provider=provider)
    tools = await get_or_refresh_tool_cache(
        db, account_record=pair.account, definition_record=pair.definition
    )
    # tools/list is filtered to the granted (provider, tools) — the agent never
    # sees a tool it may not call (§6.3). Out-of-scope providers filter to empty.
    filtered = scope.filter_tools_to_scope(
        run_scope=grant.effective_run_scope,
        worker_scope=grant.worker_scope,
        provider=provider,
        tools=tools if isinstance(tools, list) else [],
    )
    return {"provider": provider, "tools": filtered}


async def call_provider_tool(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
    provider: str,
    tool: str,
    arguments: dict[str, object],
) -> dict[str, object]:
    # Defense in depth (§6.3 / L25): tools/call re-checks scope on every request,
    # both layers, even though tools/list already hid out-of-scope tools. A denial
    # is an enumerated, agent-readable error (surfaced as an MCP error result by the
    # tools/call handler), never a 500.
    decision = scope.authorize_tool_call(
        run_scope=grant.effective_run_scope,
        worker_scope=grant.worker_scope,
        provider=provider,
        tool=tool,
    )
    if not decision.allowed:
        raise CloudApiError(
            "integration_gateway_scope_denied",
            decision.detail or "This tool is out of scope for the caller.",
            status_code=403,
        )
    # WS3a live-narrowing seam: for a workflow run token, the frozen per-run
    # capability leases are ALSO enforced (both layers must pass). A run with no
    # leases is legacy and keeps namespace-only behavior; a capability created or
    # edited after StartRun has no matching frozen lease and is denied here even
    # though the namespace layer above allowed the provider. No positive cache —
    # revalidated live on every call (archive/revoke/membership deny next call).
    if grant.run_id is not None:
        capability_decision = await capability_authz.authorize_dispatch(
            db,
            run=capability_authz.CapabilityRunContext(
                run_id=grant.run_id,
                owner_user_id=grant.owner_user_id,
                organization_id=grant.organization_id,
            ),
            provider=provider,
            tool=tool,
        )
        if not capability_decision.allowed:
            raise CloudApiError(
                "integration_gateway_capability_denied",
                capability_decision.detail
                or "This capability is not part of the run's frozen authority.",
                status_code=403,
            )
    # Function invocations are a NON-MCP branch: a raw-httpx request our server
    # makes (Part II §11), not an upstream MCP tools/call. Scope was authorized
    # above by the same two-layer machinery (``functions`` provider, tool = name).
    if provider == FUNCTION_INVOCATION_PROVIDER_NAMESPACE:
        return await functions_dispatch.call_invocation(
            db,
            owner_user_id=grant.owner_user_id,
            name=tool,
            arguments=arguments,
        )
    # Audit the proxied MCP call on every path — provider-resolution or account
    # failures, upstream transport failures, and a returned tool-level error
    # all count as evidence the call happened. ``ok`` is only True when the
    # upstream returned a non-error result.
    started = time.perf_counter()
    ok = False
    error_code: str | None = None
    try:
        pair = await account_for_provider(db, grant=grant, provider=provider)
        url, headers, query = await resolve_launch(db, pair.account, pair.definition)
        result = await mcp_remote.call_tool(
            url=url,
            headers=headers,
            tool_name=tool,
            arguments=arguments,
            query=query or None,
        )
        is_error = bool(result.get("isError", False))
        ok = not is_error
        if is_error:
            error_code = "tool_error"
        return {
            "content": result.get("content", []),
            "isError": is_error,
        }
    except CloudApiError as error:
        error_code = error.code
        raise
    except McpRemoteError as error:
        error_code = error.code or "mcp_error"
        raise
    finally:
        await tool_call_events_store.record_tool_call_event(
            db,
            user_id=grant.owner_user_id,
            organization_id=grant.organization_id,
            runtime_worker_id=grant.runtime_worker_id,
            integration_namespace=provider,
            tool_name=tool,
            ok=ok,
            error_code=error_code,
            latency_ms=int((time.perf_counter() - started) * 1000),
        )


def _initialize_result() -> dict[str, object]:
    return {
        "protocolVersion": _PROTOCOL_VERSION,
        "serverInfo": {"name": "proliferate_integrations", "version": "1"},
        "capabilities": {"tools": {}},
    }


async def _call_virtual_tool(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
    name: str,
    arguments: dict[str, object],
) -> dict[str, object]:
    if name == virtual_tools.LIST_PROVIDERS_TOOL:
        return await list_providers(db, grant=grant)
    if name == virtual_tools.LIST_TOOLS_TOOL:
        args = parse_list_tools_args(arguments)
        return await list_tools_for_provider(db, grant=grant, provider=args.provider)
    if name == virtual_tools.CALL_TOOL_TOOL:
        args = parse_call_tool_args(arguments)
        return await call_provider_tool(
            db,
            grant=grant,
            provider=args.provider,
            tool=args.tool,
            arguments=args.arguments,
        )
    raise CloudApiError(
        "integration_gateway_unknown_tool",
        f"Unknown gateway tool '{name}'.",
        status_code=404,
    )


async def _handle_tools_call(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
    params: dict[str, object],
) -> dict[str, object]:
    name = params.get("name")
    if not isinstance(name, str) or not virtual_tools.is_gateway_tool_name(name):
        raise CloudApiError(
            "integration_gateway_unknown_tool",
            "Unknown or missing tool name.",
            status_code=404,
        )
    raw_arguments = params.get("arguments") or {}
    arguments = raw_arguments if isinstance(raw_arguments, dict) else {}
    # MCP tools/call wraps the tool result in a content envelope; we return the
    # structured result as a single JSON text block plus a structuredContent
    # mirror so agents can consume either shape.
    result = await _call_virtual_tool(db, grant=grant, name=name, arguments=arguments)
    return {
        "content": [{"type": "text", "text": json.dumps(result, separators=(",", ":"))}],
        "structuredContent": result,
        "isError": False,
    }


async def handle_integration_gateway_json_rpc(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
    payload: dict[str, object],
) -> dict[str, object] | None:
    """Dispatch one MCP JSON-RPC message. ``None`` for notifications (no reply)."""
    method = payload.get("method")
    request_id = payload.get("id")
    if not isinstance(method, str):
        return json_rpc.invalid_request(request_id)

    if method == "notifications/initialized":
        return None
    if method == "initialize":
        return json_rpc.json_rpc_result(request_id=request_id, result=_initialize_result())
    if method == "tools/list":
        return json_rpc.json_rpc_result(
            request_id=request_id,
            result={"tools": virtual_tools.list_gateway_tools()},
        )
    if method == "tools/call":
        params = payload.get("params")
        params = params if isinstance(params, dict) else {}
        try:
            result = await _handle_tools_call(db, grant=grant, params=params)
        except (CloudApiError, McpRemoteError) as error:
            # Surface tool-level failures (bad provider, or an upstream MCP that
            # is down/timing out) as an MCP error result, not a transport error,
            # so the agent can react and sibling batch responses still return.
            message = error.message if isinstance(error, CloudApiError) else str(error)
            return json_rpc.json_rpc_result(
                request_id=request_id,
                result={
                    "content": [{"type": "text", "text": message}],
                    "isError": True,
                },
            )
        return json_rpc.json_rpc_result(request_id=request_id, result=result)

    return json_rpc.method_not_found(request_id, method)
