from __future__ import annotations

import ipaddress
from typing import Any
from urllib.parse import urlparse, urlunparse

import httpx

from proliferate.integrations.integration_oauth.errors import IntegrationOAuthProviderError
from proliferate.integrations.integration_oauth.models import (
    AuthorizationServerMetadata,
    ProtectedResourceMetadata,
)
from proliferate.integrations.integration_oauth.netsafety import (
    parse_public_https_origin,
    resolve_public_addresses,
)
from proliferate.integrations.integration_oauth.revocation import (
    validate_revocation_endpoint_origin,
)


def _unsafe_discovery_target() -> IntegrationOAuthProviderError:
    return IntegrationOAuthProviderError(
        "discovery_failed",
        "OAuth discovery refused a non-public or non-HTTPS URL.",
    )


async def _pinned_get(client: httpx.AsyncClient, url: str) -> httpx.Response:
    """SSRF-guarded GET: public-HTTPS-only, resolved once, address pinned.

    Discovery URLs derive from admin-supplied MCP server URLs and from the
    remote server's own responses, so every fetch target is validated —
    HTTPS-only, no userinfo, every resolved address globally routable — and
    the request then connects to the exact address that passed the check
    (Host + SNI carry the hostname), so a rebinding resolver cannot swap in a
    private address after validation (CodeQL py/full-ssrf; same pattern as
    ``revocation.revoke_token``).
    """

    try:
        hostname, port = parse_public_https_origin(url)
        addresses = await resolve_public_addresses(hostname, port)
    except ValueError as exc:
        raise _unsafe_discovery_target() from exc
    # Prefer IPv4 when both families are published (some deployment
    # environments have no IPv6 route), matching the revocation client.
    pinned_address = next(
        (address for address in addresses if ipaddress.ip_address(address).version == 4),
        addresses[0],
    )
    target = httpx.URL(url)
    pinned_url = target.copy_with(host=pinned_address)
    return await client.get(
        pinned_url,
        headers={"Host": target.netloc.decode("ascii")},
        extensions={"sni_hostname": target.raw_host.decode("ascii")},
    )


def _require_https_endpoint_shape(url: str) -> str:
    """Metadata endpoints must at least parse as public-HTTPS URLs."""

    try:
        parse_public_https_origin(url)
    except ValueError as exc:
        raise IntegrationOAuthProviderError(
            "discovery_failed",
            "OAuth provider metadata published a non-HTTPS endpoint.",
        ) from exc
    return url


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
    # Every fetch goes through the pinned SSRF guard; an unsafe ``server_url``
    # fails before any request leaves the process. Redirects are never
    # followed: a public origin must not be able to bounce this client to a
    # private one.
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=False, trust_env=False) as client:
        challenged_scope: str | None = None
        try:
            response = await _pinned_get(client, server_url)
            www_authenticate = response.headers.get("www-authenticate")
            if www_authenticate:
                params = _parse_www_authenticate(www_authenticate)
                challenged_scope = params.get("scope")
                resource_metadata_url = params.get("resource_metadata")
                if resource_metadata_url:
                    try:
                        prm_response = await _pinned_get(client, resource_metadata_url)
                    except IntegrationOAuthProviderError:
                        # An unsafe pointer is skipped, not fatal: the
                        # well-known candidates on the validated origin still
                        # get their turn (same posture as ignoring an unsafe
                        # revocation endpoint).
                        pass
                    else:
                        prm_response.raise_for_status()
                        return _parse_protected_resource(prm_response.json(), challenged_scope)
        except httpx.HTTPError:
            pass

        for candidate in _protected_resource_candidates(server_url):
            try:
                response = await _pinned_get(client, candidate)
                response.raise_for_status()
                return _parse_protected_resource(response.json(), challenged_scope)
            except (httpx.HTTPError, ValueError):
                continue
    raise IntegrationOAuthProviderError(
        "discovery_failed",
        "This MCP server did not publish OAuth protected-resource metadata.",
    )


def _parse_protected_resource(
    payload: dict[str, Any],
    challenged_scope: str | None,
) -> ProtectedResourceMetadata:
    servers = payload.get("authorization_servers")
    if not isinstance(servers, list) or not all(isinstance(item, str) for item in servers):
        raise IntegrationOAuthProviderError(
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
    # Candidates all live on the issuer's origin; an unsafe issuer fails on
    # the first pinned fetch, before any request leaves the process.
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=False, trust_env=False) as client:
        for candidate in _authorization_metadata_candidates(issuer):
            try:
                # An unsafe URL raises the provider error and aborts the loop:
                # every candidate shares the issuer's origin.
                response = await _pinned_get(client, candidate)
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError):
                continue
            methods = payload.get("code_challenge_methods_supported")
            supports_s256 = isinstance(methods, list) and "S256" in methods
            if not supports_s256:
                raise IntegrationOAuthProviderError(
                    "discovery_failed",
                    "This OAuth provider does not advertise PKCE S256 support.",
                )
            discovered_issuer = str(payload["issuer"])
            # Endpoints from the metadata document become future request
            # targets (token exchange carries client credentials); require the
            # public-HTTPS shape up front rather than at first use.
            token_endpoint = _require_https_endpoint_shape(str(payload["token_endpoint"]))
            authorization_endpoint = _require_https_endpoint_shape(
                str(payload["authorization_endpoint"])
            )
            registration_endpoint = (
                _require_https_endpoint_shape(str(payload["registration_endpoint"]))
                if payload.get("registration_endpoint")
                else None
            )
            revocation_endpoint = (
                str(payload["revocation_endpoint"]) if payload.get("revocation_endpoint") else None
            )
            if revocation_endpoint is not None:
                try:
                    validate_revocation_endpoint_origin(
                        revocation_endpoint=revocation_endpoint,
                        issuer=discovered_issuer,
                        token_endpoint=token_endpoint,
                    )
                except IntegrationOAuthProviderError:
                    # Revocation is optional. Ignore unsafe metadata rather than
                    # persisting a future credential-bearing request target.
                    revocation_endpoint = None
            return AuthorizationServerMetadata(
                issuer=discovered_issuer,
                authorization_endpoint=authorization_endpoint,
                token_endpoint=token_endpoint,
                registration_endpoint=registration_endpoint,
                token_endpoint_auth_methods_supported=_string_tuple(
                    payload.get("token_endpoint_auth_methods_supported")
                ),
                revocation_endpoint=revocation_endpoint,
            )
    raise IntegrationOAuthProviderError(
        "discovery_failed",
        "Could not discover OAuth authorization-server metadata.",
    )


def _string_tuple(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(item for item in value if isinstance(item, str))
