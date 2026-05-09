from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta

from proliferate.server.cloud.mcp_oauth.domain.flow_rules import (
    build_oauth_auth_payload,
    oauth_flow_is_expired,
    oauth_redirect_uri,
    oauth_requested_scopes_json,
    oauth_state_hash,
    oauth_status_includes_authorization_url,
    should_drop_cached_oauth_client_on_token_error,
)
from proliferate.server.cloud.mcp_oauth.domain.static_client_rules import (
    cached_static_client_matches,
)


def test_oauth_redirect_uri_prefers_configured_callback_base() -> None:
    assert (
        oauth_redirect_uri(
            configured_callback_base_url=" https://callbacks.example.com/ ",
            api_base_url="https://api.example.com",
            fallback_callback_base_url="http://localhost:8000",
        )
        == "https://callbacks.example.com/v1/cloud/mcp/oauth/callback"
    )


def test_oauth_redirect_uri_falls_back_to_api_base_and_localhost() -> None:
    assert (
        oauth_redirect_uri(
            configured_callback_base_url="",
            api_base_url=" https://api.example.com/ ",
            fallback_callback_base_url="http://localhost:8000",
        )
        == "https://api.example.com/v1/cloud/mcp/oauth/callback"
    )
    assert (
        oauth_redirect_uri(
            configured_callback_base_url="",
            api_base_url="",
            fallback_callback_base_url="http://localhost:8000",
        )
        == "http://localhost:8000/v1/cloud/mcp/oauth/callback"
    )


def test_oauth_state_hash_matches_sha256_hex() -> None:
    assert oauth_state_hash("oauth-state") == hashlib.sha256(b"oauth-state").hexdigest()


def test_oauth_flow_expiration_and_status_url_policy() -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)

    assert oauth_flow_is_expired(expires_at=now, now=now)
    assert not oauth_flow_is_expired(expires_at=now + timedelta(seconds=1), now=now)
    assert oauth_status_includes_authorization_url("active")
    assert not oauth_status_includes_authorization_url("completed")


def test_requested_scopes_and_cached_client_policy() -> None:
    assert oauth_requested_scopes_json("channels:read users:read") == (
        '["channels:read", "users:read"]'
    )
    assert oauth_requested_scopes_json(None) == "[]"
    assert should_drop_cached_oauth_client_on_token_error("invalid_client")
    assert not should_drop_cached_oauth_client_on_token_error("invalid_grant")


def test_build_oauth_auth_payload_keeps_wire_keys() -> None:
    expires_at = datetime(2026, 1, 1, tzinfo=UTC)

    assert build_oauth_auth_payload(
        issuer="https://issuer.example.com",
        resource="https://resource.example.com/mcp",
        client_id="client-id",
        access_token="access-token",
        refresh_token="refresh-token",
        expires_at=expires_at,
        scopes=("one", "two"),
        token_endpoint="https://issuer.example.com/token",
        redirect_uri="https://api.example.com/callback",
    ) == {
        "issuer": "https://issuer.example.com",
        "resource": "https://resource.example.com/mcp",
        "clientId": "client-id",
        "accessToken": "access-token",
        "refreshToken": "refresh-token",
        "expiresAt": expires_at.isoformat(),
        "scopes": ["one", "two"],
        "tokenEndpoint": "https://issuer.example.com/token",
        "redirectUri": "https://api.example.com/callback",
    }


def test_cached_static_client_match_requires_static_registration_shape() -> None:
    assert cached_static_client_matches(
        cached_resource="https://resource.example.com/mcp",
        cached_client_id="client-id",
        cached_client_secret="secret",
        cached_token_endpoint_auth_method="client_secret_post",
        cached_registration_client_uri=None,
        cached_registration_access_token_ciphertext=None,
        configured_resource="https://resource.example.com/mcp",
        configured_client_id="client-id",
        configured_client_secret="secret",
        configured_token_endpoint_auth_method="client_secret_post",
    )
    assert not cached_static_client_matches(
        cached_resource="https://resource.example.com/mcp",
        cached_client_id="client-id",
        cached_client_secret="secret",
        cached_token_endpoint_auth_method="client_secret_post",
        cached_registration_client_uri="https://issuer.example.com/register/client",
        cached_registration_access_token_ciphertext=None,
        configured_resource="https://resource.example.com/mcp",
        configured_client_id="client-id",
        configured_client_secret="secret",
        configured_token_endpoint_auth_method="client_secret_post",
    )
