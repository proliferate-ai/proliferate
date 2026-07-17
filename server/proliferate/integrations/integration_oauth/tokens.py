from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from proliferate.integrations.integration_oauth.errors import IntegrationOAuthProviderError
from proliferate.integrations.integration_oauth.models import TokenResponse

_SCOPE_SEPARATOR_RE = re.compile(r"[\s,]+")
_SLACK_TOKEN_ENDPOINT = "https://slack.com/api/oauth.v2.user.access"
_SLACK_INVALID_CLIENT_ERRORS = frozenset({"bad_client_secret", "invalid_client_id"})
_SLACK_INVALID_GRANT_ERRORS = frozenset(
    {
        "bad_redirect_uri",
        "invalid_code",
        "invalid_refresh_token",
        "token_expired",
        "token_revoked",
    }
)


def _granted_scopes(payload: dict[str, Any]) -> tuple[str, ...] | None:
    """Read standard or Slack user-token scope metadata from a token payload."""
    raw_scope: object | None = payload.get("scope") if "scope" in payload else None
    if "scope" not in payload:
        authed_user = payload.get("authed_user")
        if isinstance(authed_user, dict) and "scope" in authed_user:
            raw_scope = authed_user.get("scope")
        else:
            return None
    if not isinstance(raw_scope, str):
        return ()
    normalized: list[str] = []
    seen: set[str] = set()
    for scope in _SCOPE_SEPARATOR_RE.split(raw_scope.strip()):
        if scope and scope not in seen:
            normalized.append(scope)
            seen.add(scope)
    return tuple(normalized)


def _raise_for_slack_token_error(token_endpoint: str, payload: dict[str, Any]) -> None:
    """Translate Slack's HTTP-2xx error envelope without exposing its payload."""
    if token_endpoint != _SLACK_TOKEN_ENDPOINT or payload.get("ok") is not False:
        return
    provider_error = payload.get("error")
    if isinstance(provider_error, str) and provider_error in _SLACK_INVALID_CLIENT_ERRORS:
        raise IntegrationOAuthProviderError("invalid_client", "OAuth provider rejected client.")
    if isinstance(provider_error, str) and provider_error in _SLACK_INVALID_GRANT_ERRORS:
        raise IntegrationOAuthProviderError("invalid_grant", "OAuth grant is no longer valid.")
    raise IntegrationOAuthProviderError(
        "token_request_failed",
        "OAuth provider rejected the token request.",
    )


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
    raise IntegrationOAuthProviderError(
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
            raise IntegrationOAuthProviderError(
                "invalid_client", "OAuth provider rejected client."
            )
        if response.status_code in {400, 401, 422} and "invalid_grant" in text:
            raise IntegrationOAuthProviderError("invalid_grant", "OAuth grant is no longer valid.")
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise IntegrationOAuthProviderError(
                "token_request_failed",
                "OAuth provider rejected the token request.",
            ) from exc
        payload = response.json()
        _raise_for_slack_token_error(token_endpoint, payload)
    expires_in = payload.get("expires_in")
    expires_at = (
        datetime.now(UTC) + timedelta(seconds=int(expires_in))
        if isinstance(expires_in, int)
        else None
    )
    return TokenResponse(
        access_token=str(payload["access_token"]),
        refresh_token=payload.get("refresh_token"),
        expires_at=expires_at,
        scopes=_granted_scopes(payload),
    )
