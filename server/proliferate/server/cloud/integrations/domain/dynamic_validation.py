from __future__ import annotations

from dataclasses import dataclass

from proliferate.integrations.mcp_oauth import (
    discover_authorization_server_metadata,
    discover_protected_resource_metadata,
)
from proliferate.integrations.mcp_oauth.errors import McpOAuthProviderError
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integrations.domain.catalog_schema import (
    validate_custom_definition_input,
)
from proliferate.server.cloud.integrations.domain.oauth_strategy import (
    choose_custom_oauth_strategy,
)


@dataclass(frozen=True)
class DynamicIntegrationValidationResult:
    display_name: str
    namespace: str
    mcp_url: str
    issuer: str
    resource: str
    client_strategy: str


async def validate_dynamic_http_mcp_definition(
    *,
    display_name: str,
    namespace: str,
    mcp_url: str,
) -> DynamicIntegrationValidationResult:
    cleaned_display_name, cleaned_namespace, cleaned_mcp_url = validate_custom_definition_input(
        display_name=display_name,
        namespace=namespace,
        mcp_url=mcp_url,
    )
    try:
        resource_metadata = await discover_protected_resource_metadata(cleaned_mcp_url)
        if not resource_metadata.authorization_servers:
            raise CloudApiError(
                "integration_oauth_unavailable",
                "The integration server did not advertise any authorization servers.",
                status_code=400,
            )
        issuer = resource_metadata.authorization_servers[0]
        authorization_metadata = await discover_authorization_server_metadata(issuer)
    except McpOAuthProviderError as exc:
        raise CloudApiError(exc.code, exc.message, status_code=400) from exc
    resource = resource_metadata.resource or cleaned_mcp_url
    return DynamicIntegrationValidationResult(
        display_name=cleaned_display_name,
        namespace=cleaned_namespace,
        mcp_url=cleaned_mcp_url,
        issuer=authorization_metadata.issuer,
        resource=resource,
        client_strategy=choose_custom_oauth_strategy(authorization_metadata),
    )
