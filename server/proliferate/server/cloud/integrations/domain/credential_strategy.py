from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integrations.domain.catalog_schema import IntegrationAuthMode


@dataclass(frozen=True)
class ProviderAccess:
    headers: dict[str, str]
    token_expires_at: datetime | None


def api_key_headers(mode: IntegrationAuthMode, *, token: str) -> dict[str, str]:
    placement = mode.placement
    if not placement:
        return {"Authorization": f"Bearer {token}"}
    placement_type = placement.get("type")
    if placement_type != "header":
        raise CloudApiError(
            "integration_auth_unsupported",
            "Only header API-key placement is supported.",
            status_code=409,
        )
    name = placement.get("name")
    template = placement.get("template")
    if not isinstance(name, str) or not isinstance(template, str):
        raise CloudApiError(
            "integration_auth_invalid",
            "Integration API-key placement is invalid.",
            status_code=409,
        )
    return {name: template.replace("{{token}}", token)}


def oauth_headers(*, access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}
