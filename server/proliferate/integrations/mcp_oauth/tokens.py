from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx

from proliferate.integrations.mcp_oauth.errors import McpOAuthProviderError
from proliferate.integrations.mcp_oauth.models import TokenResponse


async def exchange_token(
    *,
    token_endpoint: str,
    client_id: str,
    code: str,
    code_verifier: str,
    redirect_uri: str,
    resource: str,
    client_secret: str | None = None,
    token_endpoint_auth_method: str | None = None,
) -> TokenResponse:
    return await _token_request(
        token_endpoint,
        {
            "grant_type": "authorization_code",
            "client_id": client_id,
            "code": code,
            "code_verifier": code_verifier,
            "redirect_uri": redirect_uri,
            "resource": resource,
        },
        client_secret=client_secret,
        token_endpoint_auth_method=token_endpoint_auth_method,
    )


async def refresh_token(
    *,
    token_endpoint: str,
    client_id: str,
    refresh_token_value: str,
    resource: str,
    client_secret: str | None = None,
    token_endpoint_auth_method: str | None = None,
) -> TokenResponse:
    return await _token_request(
        token_endpoint,
        {
            "grant_type": "refresh_token",
            "client_id": client_id,
            "refresh_token": refresh_token_value,
            "resource": resource,
        },
        client_secret=client_secret,
        token_endpoint_auth_method=token_endpoint_auth_method,
    )


def _token_request_auth_options(
    data: dict[str, str],
    *,
    client_secret: str | None,
    token_endpoint_auth_method: str | None,
) -> tuple[dict[str, str], tuple[str, str] | None]:
    if not client_secret:
        return data, None
    method = token_endpoint_auth_method or "client_secret_post"
    if method == "none":
        return data, None
    if method == "client_secret_post":
        return {**data, "client_secret": client_secret}, None
    if method == "client_secret_basic":
        return data, (data["client_id"], client_secret)
    raise McpOAuthProviderError(
        "unsupported_client_auth",
        "OAuth provider returned an unsupported client authentication method.",
    )


async def _token_request(
    token_endpoint: str,
    data: dict[str, str],
    *,
    client_secret: str | None,
    token_endpoint_auth_method: str | None,
) -> TokenResponse:
    request_data, auth = _token_request_auth_options(
        data,
        client_secret=client_secret,
        token_endpoint_auth_method=token_endpoint_auth_method,
    )
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(token_endpoint, data=request_data, auth=auth)
        text = response.text
        if response.status_code in {400, 401, 422} and "invalid_client" in text:
            raise McpOAuthProviderError("invalid_client", "OAuth provider rejected client.")
        if response.status_code in {400, 401, 422} and "invalid_grant" in text:
            raise McpOAuthProviderError("invalid_grant", "OAuth grant is no longer valid.")
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise McpOAuthProviderError(
                "token_request_failed",
                "OAuth provider rejected the token request.",
            ) from exc
        payload = response.json()
    expires_in = payload.get("expires_in")
    expires_at = (
        datetime.now(UTC) + timedelta(seconds=int(expires_in))
        if isinstance(expires_in, int)
        else None
    )
    scope = payload.get("scope")
    return TokenResponse(
        access_token=str(payload["access_token"]),
        refresh_token=payload.get("refresh_token"),
        expires_at=expires_at,
        scopes=tuple(str(scope).split()) if scope else (),
    )
