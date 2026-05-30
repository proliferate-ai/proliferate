from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import quote, urlsplit

from proliferate.constants.cloud_mcp import CLOUD_MCP_OAUTH_CALLBACK_PATH

OAUTH_CALLBACK_SURFACES = {"desktop", "web"}
OAUTH_FINAL_SURFACES = {"desktop", "web"}
OAUTH_WEB_COMPLETION_PATH = "/plugins/connect/complete"


def oauth_state_hash(state: str) -> str:
    return hashlib.sha256(state.encode("utf-8")).hexdigest()


def resolve_callback_base_url(
    *,
    configured_callback_base_url: str,
    api_base_url: str,
    fallback_callback_base_url: str = "",
) -> str:
    base = configured_callback_base_url.strip() or api_base_url.strip()
    if not base:
        base = fallback_callback_base_url.strip()
    return base.rstrip("/")


def oauth_redirect_uri(
    *,
    configured_callback_base_url: str,
    api_base_url: str,
    fallback_callback_base_url: str = "",
) -> str:
    base_url = resolve_callback_base_url(
        configured_callback_base_url=configured_callback_base_url,
        api_base_url=api_base_url,
        fallback_callback_base_url=fallback_callback_base_url,
    )
    return f"{base_url}{CLOUD_MCP_OAUTH_CALLBACK_PATH}"


def oauth_flow_is_expired(*, expires_at: datetime, now: datetime) -> bool:
    return expires_at <= now


def oauth_status_includes_authorization_url(status: str) -> bool:
    return status == "active"


def oauth_requested_scopes_json(challenged_scope: str | None) -> str:
    return json.dumps(challenged_scope.split() if challenged_scope else [])


def should_drop_cached_oauth_client_on_token_error(error_code: str) -> bool:
    return error_code == "invalid_client"


class OAuthReturnTargetError(ValueError):
    """Raised when an OAuth return target cannot be accepted safely."""


@dataclass(frozen=True)
class OAuthReturnTarget:
    callback_surface: str
    final_surface: str
    return_path: str | None


def normalize_oauth_return_target(
    *,
    callback_surface: str | None,
    final_surface: str | None,
    return_path: str | None,
    frontend_base_url: str,
) -> OAuthReturnTarget:
    resolved_callback_surface = (callback_surface or "desktop").strip()
    if resolved_callback_surface not in OAUTH_CALLBACK_SURFACES:
        raise OAuthReturnTargetError("Unsupported OAuth callback surface.")

    resolved_final_surface = (final_surface or resolved_callback_surface).strip()
    if resolved_final_surface not in OAUTH_FINAL_SURFACES:
        raise OAuthReturnTargetError("Unsupported OAuth final surface.")

    normalized_return_path = _normalize_oauth_return_path(return_path)
    if resolved_callback_surface == "desktop":
        if resolved_final_surface != "desktop":
            raise OAuthReturnTargetError("Desktop callback must return to desktop.")
        if normalized_return_path is not None:
            raise OAuthReturnTargetError("Desktop callback does not accept a return path.")
    else:
        if not frontend_base_url.strip():
            raise OAuthReturnTargetError("Web OAuth callback requires a frontend base URL.")
        _validate_frontend_base_url(frontend_base_url)
        if normalized_return_path != OAUTH_WEB_COMPLETION_PATH:
            raise OAuthReturnTargetError("Web OAuth callback requires the plugin completion path.")

    return OAuthReturnTarget(
        callback_surface=resolved_callback_surface,
        final_surface=resolved_final_surface,
        return_path=normalized_return_path,
    )


def build_oauth_web_completion_url(
    *,
    frontend_base_url: str,
    return_path: str,
    flow_id: str,
    status: str,
    final_surface: str,
    failure_code: str | None,
) -> str:
    base = _validate_frontend_base_url(frontend_base_url)
    query = {
        "source": "mcp_oauth_callback",
        "flowId": flow_id,
        "status": status,
        "finalSurface": final_surface,
    }
    if failure_code:
        query["failureCode"] = failure_code
    encoded = "&".join(
        f"{quote(key, safe='')}={quote(value, safe='')}" for key, value in query.items()
    )
    return f"{base}{return_path}?{encoded}"


def _normalize_oauth_return_path(return_path: str | None) -> str | None:
    if return_path is None:
        return None
    path = return_path.strip()
    if not path:
        return None
    if path != OAUTH_WEB_COMPLETION_PATH:
        raise OAuthReturnTargetError("OAuth return path is not allowed.")
    parts = urlsplit(path)
    if parts.scheme or parts.netloc or parts.query or parts.fragment:
        raise OAuthReturnTargetError("OAuth return path must be a bare relative path.")
    if "\\" in path or any(ord(char) < 32 for char in path):
        raise OAuthReturnTargetError("OAuth return path contains invalid characters.")
    return path


def _validate_frontend_base_url(frontend_base_url: str) -> str:
    base = frontend_base_url.strip().rstrip("/")
    parts = urlsplit(base)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        raise OAuthReturnTargetError("Frontend base URL is not configured correctly.")
    return base


def build_oauth_auth_payload(
    *,
    issuer: str | None,
    resource: str | None,
    client_id: str,
    access_token: str,
    refresh_token: str | None,
    expires_at: datetime | None,
    scopes: tuple[str, ...],
    token_endpoint: str | None,
    redirect_uri: str,
) -> dict[str, object]:
    return {
        "issuer": issuer,
        "resource": resource,
        "clientId": client_id,
        "accessToken": access_token,
        "refreshToken": refresh_token,
        "expiresAt": expires_at.isoformat() if expires_at else None,
        "scopes": list(scopes),
        "tokenEndpoint": token_endpoint,
        "redirectUri": redirect_uri,
    }
