from __future__ import annotations

from fastapi import Request

from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integration_gateway.tokens import (
    IntegrationGatewayGrant,
    decode_integration_gateway_grant,
)


def integration_gateway_grant_from_request(request: Request) -> IntegrationGatewayGrant:
    authorization = request.headers.get("authorization")
    if not authorization:
        raise CloudApiError(
            "integration_gateway_unauthorized", "Missing gateway token.", status_code=401
        )
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value:
        raise CloudApiError(
            "integration_gateway_unauthorized", "Missing gateway token.", status_code=401
        )
    return decode_integration_gateway_grant(value)
