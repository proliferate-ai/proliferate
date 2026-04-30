from __future__ import annotations

import base64
import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import httpx


class McpOAuthProviderError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class ProtectedResourceMetadata:
    authorization_servers: tuple[str, ...]
    resource: str | None
    challenged_scope: str | None


@dataclass(frozen=True)
class AuthorizationServerMetadata:
    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    registration_endpoint: str | None


@dataclass(frozen=True)
class RegisteredOAuthClient:
    client_id: str
    client_secret: str | None
    client_secret_expires_at: datetime | None
    token_endpoint_auth_method: str | None
    registration_client_uri: str | None
    registration_access_token: str | None


@dataclass(frozen=True)
class TokenResponse:
    access_token: str
    refresh_token: str | None
    expires_at: datetime | None
    scopes: tuple[str, ...]


def random_urlsafe(size: int = 32) -> str:
    return secrets.token_urlsafe(size)


def code_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def normalize_resource_url(value: str) -> str:
    parsed = urlparse(value)
    scheme = parsed.scheme.lower()
    netloc = parsed.netloc.lower()
    if netloc.endswith(":443") and scheme == "https":
        netloc = netloc[:-4]
    if netloc.endswith(":80") and scheme == "http":
        netloc = netloc[:-3]
    query = urlencode(sorted(parse_qsl(parsed.query, keep_blank_values=True)))
    return urlunparse((scheme, netloc, parsed.path or "/", "", query, ""))


def _protected_resource_candidates(server_url: str) -> list[str]:
    parsed = urlparse(server_url)
    candidates: list[str] = []
    if parsed.path and parsed.path != "/":
        candidates.append(
            urlunparse(
                (
                    parsed.scheme,
                    parsed.netloc,
                    f"/.well-known/oauth-protected-resource{parsed.path}",
                    "",
                    parsed.query,
                    "",
                )
            )
        )
    candidates.append(
        urlunparse(
            (
                parsed.scheme,
                parsed.netloc,
                "/.well-known/oauth-protected-resource",
                "",
                "",
                "",
            )
        )
    )
    return candidates


def _authorization_metadata_candidates(issuer: str) -> list[str]:
    parsed = urlparse(issuer)
    candidates = [
        urlunparse(
            (
                parsed.scheme,
                parsed.netloc,
                "/.well-known/oauth-authorization-server",
                "",
                "",
                "",
            )
        ),
        urlunparse(
            (
                parsed.scheme,
                parsed.netloc,
                "/.well-known/openid-configuration",
                "",
                "",
                "",
            )
        ),
    ]
    issuer_path = parsed.path.rstrip("/")
    if issuer_path and issuer_path != "/":
        candidates.append(
            urlunparse(
                (
                    parsed.scheme,
                    parsed.netloc,
                    f"{issuer_path}/.well-known/openid-configuration",
                    "",
                    "",
                    "",
                )
            )
        )
    return candidates


def _parse_www_authenticate(value: str) -> dict[str, str]:
    bearer = value.removeprefix("Bearer ").strip()
    result: dict[str, str] = {}
    current = ""
    in_quotes = False
    for char in bearer:
        if char == '"':
            in_quotes = not in_quotes
        if char == "," and not in_quotes:
            _insert_www_auth_param(result, current)
            current = ""
        else:
            current += char
    _insert_www_auth_param(result, current)
    return result


def _insert_www_auth_param(target: dict[str, str], raw: str) -> None:
    if "=" not in raw:
        return
    key, value = raw.split("=", 1)
    target[key.strip()] = value.strip().strip('"')


async def discover_protected_resource_metadata(server_url: str) -> ProtectedResourceMetadata:
    async with httpx.AsyncClient(timeout=20.0) as client:
        challenged_scope: str | None = None
        try:
            response = await client.get(server_url)
            www_authenticate = response.headers.get("www-authenticate")
            if www_authenticate:
                params = _parse_www_authenticate(www_authenticate)
                challenged_scope = params.get("scope")
                resource_metadata_url = params.get("resource_metadata")
                if resource_metadata_url:
                    prm_response = await client.get(resource_metadata_url)
                    prm_response.raise_for_status()
                    return _parse_protected_resource(prm_response.json(), challenged_scope)
        except httpx.HTTPError:
            pass

        for candidate in _protected_resource_candidates(server_url):
            try:
                response = await client.get(candidate)
                response.raise_for_status()
                return _parse_protected_resource(response.json(), challenged_scope)
            except (httpx.HTTPError, ValueError):
                continue
    raise McpOAuthProviderError(
        "discovery_failed",
        "This MCP server did not publish OAuth protected-resource metadata.",
    )


def _parse_protected_resource(
    payload: dict[str, Any],
    challenged_scope: str | None,
) -> ProtectedResourceMetadata:
    servers = payload.get("authorization_servers")
    if not isinstance(servers, list) or not all(isinstance(item, str) for item in servers):
        raise McpOAuthProviderError(
            "discovery_failed",
            "Protected resource metadata did not include authorization servers.",
        )
    resource = payload.get("resource")
    return ProtectedResourceMetadata(
        authorization_servers=tuple(servers),
        resource=resource if isinstance(resource, str) else None,
        challenged_scope=challenged_scope,
    )


async def discover_authorization_server_metadata(
    issuer: str,
) -> AuthorizationServerMetadata:
    async with httpx.AsyncClient(timeout=20.0) as client:
        for candidate in _authorization_metadata_candidates(issuer):
            try:
                response = await client.get(candidate)
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError):
                continue
            methods = payload.get("code_challenge_methods_supported")
            supports_s256 = isinstance(methods, list) and "S256" in methods
            if not supports_s256:
                raise McpOAuthProviderError(
                    "discovery_failed",
                    "This OAuth provider does not advertise PKCE S256 support.",
                )
            return AuthorizationServerMetadata(
                issuer=str(payload["issuer"]),
                authorization_endpoint=str(payload["authorization_endpoint"]),
                token_endpoint=str(payload["token_endpoint"]),
                registration_endpoint=(
                    str(payload["registration_endpoint"])
                    if payload.get("registration_endpoint")
                    else None
                ),
            )
    raise McpOAuthProviderError(
        "discovery_failed",
        "Could not discover OAuth authorization-server metadata.",
    )


async def register_client(
    metadata: AuthorizationServerMetadata,
    redirect_uri: str,
) -> RegisteredOAuthClient:
    if not metadata.registration_endpoint:
        raise McpOAuthProviderError(
            "registration_failed",
            "This OAuth provider does not support dynamic client registration.",
        )
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            metadata.registration_endpoint,
            json={
                "client_name": "Proliferate",
                "application_type": "web",
                "redirect_uris": [redirect_uri],
                "grant_types": ["authorization_code", "refresh_token"],
                "response_types": ["code"],
                "token_endpoint_auth_method": "none",
            },
        )
        response.raise_for_status()
        payload = response.json()
    return RegisteredOAuthClient(
        client_id=str(payload["client_id"]),
        client_secret=payload.get("client_secret"),
        client_secret_expires_at=_client_secret_expires_at(
            payload.get("client_secret_expires_at")
        ),
        token_endpoint_auth_method=payload.get("token_endpoint_auth_method"),
        registration_client_uri=payload.get("registration_client_uri"),
        registration_access_token=payload.get("registration_access_token"),
    )


def build_authorization_url(
    *,
    metadata: AuthorizationServerMetadata,
    client_id: str,
    redirect_uri: str,
    state: str,
    verifier: str,
    resource: str,
    scope: str | None,
) -> str:
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "code_challenge": code_challenge(verifier),
        "code_challenge_method": "S256",
        "state": state,
        "resource": resource,
    }
    if scope:
        params["scope"] = scope
    separator = "&" if "?" in metadata.authorization_endpoint else "?"
    return f"{metadata.authorization_endpoint}{separator}{urlencode(params)}"


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


def _client_secret_expires_at(value: object) -> datetime | None:
    if isinstance(value, int) and value > 0:
        return datetime.fromtimestamp(value, tz=UTC)
    return None
