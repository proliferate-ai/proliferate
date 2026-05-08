from __future__ import annotations

from typing import Any
from urllib.parse import urlparse, urlunparse

import httpx

from proliferate.integrations.mcp_oauth.errors import McpOAuthProviderError
from proliferate.integrations.mcp_oauth.models import (
    AuthorizationServerMetadata,
    ProtectedResourceMetadata,
)


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
                token_endpoint_auth_methods_supported=_string_tuple(
                    payload.get("token_endpoint_auth_methods_supported")
                ),
            )
    raise McpOAuthProviderError(
        "discovery_failed",
        "Could not discover OAuth authorization-server metadata.",
    )


def _string_tuple(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(item for item in value if isinstance(item, str))
