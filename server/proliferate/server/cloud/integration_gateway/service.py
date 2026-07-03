"""Integration gateway JSON-RPC service.

Resolves the gateway grant to its owner, exposes that owner's ready
integration accounts as three virtual MCP tools, and proxies tool calls to the
upstream MCP with Cloud-held credentials. Provider credentials never leave
Cloud; AnyHarness only ever holds the gateway bearer token.
"""

from __future__ import annotations

import json

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.integrations import accounts as accounts_store
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
from proliferate.server.cloud.integration_gateway.models import GatewayProviderAccount
from proliferate.server.cloud.integrations.access import resolve_launch
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
) -> dict[str, object]:
    pair = await account_for_provider(db, grant=grant, provider=provider)
    url, headers, query = await resolve_launch(db, pair.account, pair.definition)
    result = await mcp_remote.call_tool(
        url=url,
        headers=headers,
        tool_name=tool,
        arguments=arguments,
        query=query or None,
    )
    return {
        "content": result.get("content", []),
        "isError": bool(result.get("isError", False)),
    }


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
