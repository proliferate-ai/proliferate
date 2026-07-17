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

from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import tool_call_events as tool_call_events_store
from proliferate.db.store.integrations.accounts import ReadyAccountRow
from proliferate.db.store.runtime_workers import IntegrationGatewayGrant
from proliferate.integrations import mcp_remote
from proliferate.integrations.mcp_remote import McpRemoteError
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integration_gateway.domain import json_rpc, virtual_tools
from proliferate.server.cloud.integration_gateway.domain.tool_args import (
    parse_call_tool_args,
    parse_list_tools_args,
)
from proliferate.server.cloud.integration_gateway.domain.tool_policy import (
    ToolCallAllowed,
    ToolCallDenied,
    ToolCallRequiresApproval,
    decide_tool_call,
)
from proliferate.server.cloud.integration_gateway.errors import (
    IntegrationGatewaySessionRequired,
    IntegrationToolApprovalRequired,
    IntegrationToolNotAllowed,
    IntegrationToolPolicyError,
)
from proliferate.server.cloud.integration_gateway.models import GatewayProviderAccount
from proliferate.server.cloud.integrations.access import resolve_launch
from proliferate.server.cloud.integrations.action_approvals.domain.actions import (
    InvalidActionPayload,
)
from proliferate.server.cloud.integrations.action_approvals.service import (
    ActionApprovalAccountRevisionMismatch,
)
from proliferate.server.cloud.integrations.action_approvals.transactions import (
    request_action_approval_committed,
)
from proliferate.server.cloud.integrations.tools import get_or_refresh_tool_cache

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


def _org_allows_identity(
    grant: IntegrationGatewayGrant,
    row: accounts_store.ReadyAccountIdentityRow,
) -> bool:
    if grant.organization_id is None:
        return True
    if row.org_policy_enabled is not None:
        return row.org_policy_enabled
    return row.definition_enabled_by_default


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


async def account_identity_for_provider(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
    provider: str,
) -> accounts_store.ReadyAccountIdentityRow:
    """Resolve a ready provider binding without selecting credential columns."""
    row = await accounts_store.get_ready_account_identity_for_provider(
        db,
        grant.owner_user_id,
        provider,
        organization_id=grant.organization_id,
    )
    if row is None:
        raise CloudApiError(
            "integration_provider_not_found",
            f"No connected integration provider '{provider}'.",
            status_code=404,
        )
    if not _org_allows_identity(grant, row):
        raise CloudApiError(
            "integration_provider_disabled",
            f"Integration provider '{provider}' is disabled by your organization's policy.",
            status_code=404,
        )
    return row


async def list_providers(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
) -> dict[str, object]:
    providers = [
        {
            "provider": pair.definition.namespace,
            "displayName": pair.definition.display_name,
            "authKind": pair.definition.auth_kind,
            "status": pair.account.status,
        }
        for pair in await ready_accounts_for_grant(db, grant=grant)
    ]
    return {"providers": providers}


async def list_tools_for_provider(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
    provider: str,
) -> dict[str, object]:
    pair = await account_for_provider(db, grant=grant, provider=provider)
    tools = await get_or_refresh_tool_cache(
        db, account_record=pair.account, definition_record=pair.definition
    )
    return {"provider": provider, "tools": tools}


async def call_provider_tool(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
    provider: str,
    tool: str,
    arguments: dict[str, object],
    gateway_session_id: UUID | None,
) -> dict[str, object]:
    # Audit the proxied call on every path — provider-resolution or account
    # failures, upstream transport failures, and a returned tool-level error
    # all count as evidence the call happened. ``ok`` is only True when the
    # upstream returned a non-error result.
    started = time.perf_counter()
    ok = False
    error_code: str | None = None
    try:
        decision = decide_tool_call(provider=provider, tool=tool)
        if isinstance(decision, ToolCallRequiresApproval):
            if gateway_session_id is None:
                raise IntegrationGatewaySessionRequired(provider=provider, tool=tool)
            # Resolve only the ready account identity needed to bind the
            # request. Credential rendering and provider I/O remain below the
            # allowed path and are never entered for an approval-gated action.
            account_identity = await account_identity_for_provider(
                db,
                grant=grant,
                provider=provider,
            )
            try:
                approval = await request_action_approval_committed(
                    grant=grant,
                    gateway_session_id=gateway_session_id,
                    integration_account_id=account_identity.account_id,
                    integration_account_auth_version=account_identity.auth_version,
                    verdict=decision,
                    arguments=arguments,
                    account_label=(
                        f"{account_identity.display_name} connection "
                        f"{str(account_identity.account_id)[:8]}"
                    ),
                    source_label=(
                        f"{grant.runtime_kind.title()} MCP session {str(gateway_session_id)[:8]}"
                    ),
                )
            except InvalidActionPayload as error:
                raise CloudApiError(
                    "integration_action_payload_invalid",
                    "Integration action arguments must be valid JSON values.",
                    status_code=400,
                ) from error
            except ActionApprovalAccountRevisionMismatch as error:
                raise CloudApiError(
                    "integration_account_changed",
                    "Integration account changed before approval could be requested.",
                    status_code=409,
                ) from error
            raise IntegrationToolApprovalRequired(
                provider=provider,
                tool=tool,
                approval=approval,
            )
        if isinstance(decision, ToolCallDenied):
            raise IntegrationToolNotAllowed(provider=provider, tool=tool)
        if not isinstance(decision, ToolCallAllowed):
            raise IntegrationToolNotAllowed(provider=provider, tool=tool)
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
    gateway_session_id: UUID | None,
) -> dict[str, object]:
    if name == virtual_tools.LIST_PROVIDERS_TOOL:
        return await list_providers(db, grant=grant)
    if name == virtual_tools.LIST_TOOLS_TOOL:
        list_args = parse_list_tools_args(arguments)
        return await list_tools_for_provider(db, grant=grant, provider=list_args.provider)
    if name == virtual_tools.CALL_TOOL_TOOL:
        call_args = parse_call_tool_args(arguments)
        return await call_provider_tool(
            db,
            grant=grant,
            provider=call_args.provider,
            tool=call_args.tool,
            arguments=call_args.arguments,
            gateway_session_id=gateway_session_id,
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
    gateway_session_id: UUID | None,
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
    result = await _call_virtual_tool(
        db,
        grant=grant,
        name=name,
        arguments=arguments,
        gateway_session_id=gateway_session_id,
    )
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
    gateway_session_id: UUID | None = None,
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
            result = await _handle_tools_call(
                db,
                grant=grant,
                params=params,
                gateway_session_id=gateway_session_id,
            )
        except IntegrationToolPolicyError as error:
            return json_rpc.json_rpc_result(
                request_id=request_id,
                result={
                    "content": [{"type": "text", "text": error.message}],
                    "structuredContent": {"error": error.structured_error()},
                    "isError": True,
                },
            )
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
