from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta

from proliferate.server.cloud.mcp_oauth.domain.flow_rules import (
    OAUTH_WEB_COMPLETION_PATH,
    OAuthReturnTargetError,
    build_oauth_web_completion_url,
    build_oauth_auth_payload,
    normalize_oauth_return_target,
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


def test_oauth_return_target_defaults_to_legacy_desktop() -> None:
    target = normalize_oauth_return_target(
        callback_surface=None,
        final_surface=None,
        return_path=None,
        frontend_base_url="",
    )

    assert target.callback_surface == "desktop"
    assert target.final_surface == "desktop"
    assert target.return_path is None


def test_oauth_return_target_accepts_web_completion_for_desktop_final_surface() -> None:
    target = normalize_oauth_return_target(
        callback_surface="web",
        final_surface="desktop",
        return_path=OAUTH_WEB_COMPLETION_PATH,
        frontend_base_url="https://app.example.com/",
    )

    assert target.callback_surface == "web"
    assert target.final_surface == "desktop"
    assert target.return_path == OAUTH_WEB_COMPLETION_PATH


def test_oauth_return_target_rejects_unsafe_paths() -> None:
    for path in (
        "https://evil.example.com/plugins/connect/complete",
        "//evil.example.com/plugins/connect/complete",
        "/plugins/connect/complete?source=bad",
        "/plugins/connect/complete#frag",
        "/plugins",
        "/plugins\\connect\\complete",
    ):
        try:
            normalize_oauth_return_target(
                callback_surface="web",
                final_surface="web",
                return_path=path,
                frontend_base_url="https://app.example.com",
            )
        except OAuthReturnTargetError:
            continue
        raise AssertionError(f"accepted unsafe return path: {path}")


def test_oauth_web_completion_url_uses_server_owned_params() -> None:
    assert build_oauth_web_completion_url(
        frontend_base_url="https://app.example.com/",
        return_path=OAUTH_WEB_COMPLETION_PATH,
        flow_id="flow-id",
        status="failed",
        final_surface="desktop",
        failure_code="access_denied",
    ) == (
        "https://app.example.com/plugins/connect/complete?"
        "source=mcp_oauth_callback&flowId=flow-id&status=failed&"
        "finalSurface=desktop&failureCode=access_denied"
    )


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
