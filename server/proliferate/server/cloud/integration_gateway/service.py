from __future__ import annotations

import json

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_integrations import accounts as account_store
from proliferate.db.store.cloud_integrations.types import IntegrationAccountWithDefinitionRecord
from proliferate.integrations import mcp_remote
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integration_gateway.domain.json_rpc import (
    json_rpc_error,
    json_rpc_result,
)
from proliferate.server.cloud.integration_gateway.tokens import IntegrationGatewayGrant
from proliferate.server.cloud.integrations.domain.catalog_schema import (
    parse_definition_config,
    render_mcp_url,
)
from proliferate.server.cloud.integrations.domain.tool_names import (
    gateway_tool_name,
    split_gateway_tool_name,
)
from proliferate.server.cloud.integrations.service import (
    ensure_provider_access,
    get_or_refresh_tool_cache,
)


async def handle_integration_gateway_json_rpc(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
    payload: dict[str, object],
) -> dict[str, object] | None:
    request_id = payload.get("id")
    method = payload.get("method")
    if not isinstance(method, str):
        return json_rpc_error(request_id=request_id, code=-32600, message="Invalid request.")
    try:
        if method == "initialize":
            return json_rpc_result(request_id=request_id, result=_initialize_result())
        if method == "notifications/initialized":
            return None
        if method == "tools/list":
            return json_rpc_result(
                request_id=request_id,
                result={"tools": await _list_tools(db, grant=grant)},
            )
        if method == "tools/call":
            params = payload.get("params")
            if not isinstance(params, dict):
                raise CloudApiError(
                    "invalid_payload", "tools/call params are required.", status_code=400
                )
            return json_rpc_result(
                request_id=request_id,
                result=await _call_tool(db, grant=grant, params=params),
            )
    except CloudApiError as exc:
        return json_rpc_error(request_id=request_id, code=exc.status_code, message=exc.message)
    except mcp_remote.McpRemoteError as exc:
        return json_rpc_error(request_id=request_id, code=-32000, message=exc.message)
    return json_rpc_error(request_id=request_id, code=-32601, message="Method not found.")


async def ready_accounts_for_grant(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
) -> tuple[IntegrationAccountWithDefinitionRecord, ...]:
    if grant.owner_scope == "personal" and grant.owner_user_id is not None:
        return await account_store.list_ready_accounts_for_personal_profile(
            db, grant.owner_user_id
        )
    if grant.owner_scope == "organization" and grant.organization_id is not None:
        return await account_store.list_ready_accounts_for_organization_profile(
            db,
            grant.organization_id,
        )
    return ()


async def _list_tools(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
) -> list[dict[str, object]]:
    tools: list[dict[str, object]] = []
    for account in await ready_accounts_for_grant(db, grant=grant):
        cache = await get_or_refresh_tool_cache(db, account)
        for tool in _tools_from_cache(cache.tools_json):
            name = tool.get("name")
            if not isinstance(name, str) or not name:
                continue
            tools.append(
                {
                    **tool,
                    "name": gateway_tool_name(account.definition.namespace, name),
                    "annotations": {
                        **(
                            tool.get("annotations")
                            if isinstance(tool.get("annotations"), dict)
                            else {}
                        ),
                        "proliferateIntegrationNamespace": account.definition.namespace,
                        "proliferateIntegrationDisplayName": account.definition.display_name,
                        "proliferateUpstreamToolName": name,
                    },
                }
            )
    return tools


async def _call_tool(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
    params: dict[str, object],
) -> dict[str, object]:
    name = params.get("name")
    if not isinstance(name, str):
        raise CloudApiError("invalid_payload", "Tool name is required.", status_code=400)
    namespace, upstream_name = split_gateway_tool_name(name)
    arguments = params.get("arguments")
    if arguments is None:
        arguments = {}
    if not isinstance(arguments, dict):
        raise CloudApiError(
            "invalid_payload", "Tool arguments must be an object.", status_code=400
        )
    account = await _account_for_namespace(db, grant=grant, namespace=namespace)
    access = await ensure_provider_access(db, account)
    config = parse_definition_config(account.definition.config_json)
    result = await mcp_remote.call_tool(
        url=render_mcp_url(config, _json_object(account.account.settings_json)),
        headers=access.headers,
        tool_name=upstream_name,
        arguments=arguments,
    )
    return {
        "content": result.content,
        "isError": result.is_error,
    }


async def _account_for_namespace(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
    namespace: str,
) -> IntegrationAccountWithDefinitionRecord:
    for account in await ready_accounts_for_grant(db, grant=grant):
        if account.definition.namespace == namespace:
            return account
    raise CloudApiError(
        "integration_tool_not_found", "Integration tool was not found.", status_code=404
    )


def _initialize_result() -> dict[str, object]:
    return {
        "protocolVersion": "2025-06-18",
        "serverInfo": {"name": "proliferate_integrations", "version": "1.0.0"},
        "capabilities": {"tools": {}},
    }


def _tools_from_cache(tools_json: str) -> list[dict[str, object]]:
    try:
        parsed = json.loads(tools_json or "[]")
    except json.JSONDecodeError:
        return []
    return [tool for tool in parsed if isinstance(tool, dict)] if isinstance(parsed, list) else []


def _json_object(value: str) -> dict[str, object]:
    try:
        parsed = json.loads(value or "{}")
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}
