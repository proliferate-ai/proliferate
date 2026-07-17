from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

import pytest

from proliferate.integrations.integration_oauth import (
    AuthorizationServerMetadata,
    IntegrationOAuthProviderError,
    build_authorization_url,
)
from proliferate.server.cloud.integrations.oauth.service import (
    _resolve_requested_oauth_scope,
)


def _authorization_scope(scope: str | None) -> list[str] | None:
    url = build_authorization_url(
        metadata=AuthorizationServerMetadata(
            issuer="https://auth.example.com",
            authorization_endpoint="https://auth.example.com/authorize",
            token_endpoint="https://auth.example.com/token",
            registration_endpoint=None,
            token_endpoint_auth_methods_supported=("none",),
        ),
        client_id="client-id",
        redirect_uri="https://api.example.com/callback",
        state="state",
        verifier="verifier",
        resource="https://mcp.example.com/mcp",
        scope=scope,
    )
    return parse_qs(urlsplit(url).query).get("scope")


def test_oauth_scope_challenge_wins_over_configured_fallback() -> None:
    requested_scope = _resolve_requested_oauth_scope(
        challenged_scope="provider:read provider:write",
        configured_scopes=("configured:read",),
        scopes_required=True,
    )

    assert requested_scope == "provider:read provider:write"
    assert _authorization_scope(requested_scope) == ["provider:read provider:write"]


def test_oauth_scope_uses_configured_fallback_once() -> None:
    requested_scope = _resolve_requested_oauth_scope(
        challenged_scope=None,
        configured_scopes=("search:read.public", "search:read.private"),
        scopes_required=True,
    )

    assert requested_scope == "search:read.public search:read.private"
    assert _authorization_scope(requested_scope) == ["search:read.public search:read.private"]


def test_oauth_scope_remains_optional_for_generic_providers() -> None:
    requested_scope = _resolve_requested_oauth_scope(
        challenged_scope=None,
        configured_scopes=(),
        scopes_required=False,
    )

    assert requested_scope is None
    assert _authorization_scope(requested_scope) is None


def test_required_oauth_scope_missing_raises_typed_error() -> None:
    with pytest.raises(IntegrationOAuthProviderError) as exc_info:
        _resolve_requested_oauth_scope(
            challenged_scope=None,
            configured_scopes=(),
            scopes_required=True,
        )

    assert exc_info.value.code == "missing_oauth_scope"
