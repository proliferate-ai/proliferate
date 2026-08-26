"""OAuth token revocation requests with provider-safe error translation."""

from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit

import httpx

from proliferate.integrations.integration_oauth.errors import IntegrationOAuthProviderError
from proliferate.integrations.integration_oauth.netsafety import (
    parse_public_https_origin,
    resolve_host_addresses,
)


def _invalid_endpoint() -> IntegrationOAuthProviderError:
    return IntegrationOAuthProviderError(
        "revocation_endpoint_invalid",
        "OAuth provider published an unsafe token revocation endpoint.",
    )


def _https_origin(value: str) -> tuple[str, int]:
    try:
        return parse_public_https_origin(value)
    except ValueError as exc:
        raise _invalid_endpoint() from exc


def validate_revocation_endpoint_origin(
    *,
    revocation_endpoint: str,
    issuer: str,
    token_endpoint: str,
) -> None:
    """Require the revocation sink to be an existing HTTPS credential origin."""

    endpoint_origin = _https_origin(revocation_endpoint)
    trusted_origins: set[tuple[str, int]] = set()
    for trusted_endpoint in (issuer, token_endpoint):
        if not trusted_endpoint:
            continue
        try:
            trusted_origins.add(_https_origin(trusted_endpoint))
        except IntegrationOAuthProviderError:
            continue
    if endpoint_origin not in trusted_origins:
        raise _invalid_endpoint()


async def _resolve_host_addresses(hostname: str, port: int) -> tuple[str, ...]:
    try:
        return await resolve_host_addresses(hostname, port)
    except ValueError as exc:
        raise _invalid_endpoint() from exc


async def _public_destination_addresses(revocation_endpoint: str) -> tuple[str, ...]:
    parsed = urlsplit(revocation_endpoint)
    assert parsed.hostname is not None  # validated by validate_revocation_endpoint_origin
    try:
        direct_address = ipaddress.ip_address(parsed.hostname)
    except ValueError:
        addresses = await _resolve_host_addresses(parsed.hostname, parsed.port or 443)
        if not addresses:
            raise _invalid_endpoint() from None
        try:
            resolved = tuple(ipaddress.ip_address(address) for address in addresses)
        except ValueError as exc:
            raise _invalid_endpoint() from exc
    else:
        resolved = (direct_address,)
    if any(not address.is_global for address in resolved):
        raise _invalid_endpoint()
    return tuple(str(address) for address in resolved)


async def validate_revocation_endpoint_destination(
    *,
    revocation_endpoint: str,
    issuer: str,
    token_endpoint: str,
) -> str:
    """Return the public address that the credential-bearing request must use."""

    validate_revocation_endpoint_origin(
        revocation_endpoint=revocation_endpoint,
        issuer=issuer,
        token_endpoint=token_endpoint,
    )
    addresses = await _public_destination_addresses(revocation_endpoint)
    # Prefer IPv4 when a provider publishes both families: several deployment
    # environments have no IPv6 route. Either way, the selected address is the
    # exact address used for the socket rather than a discarded DNS preflight.
    return next(
        (address for address in addresses if ipaddress.ip_address(address).version == 4),
        addresses[0],
    )


def _auth_options(
    data: dict[str, str],
    *,
    client_id: str,
    client_secret: str | None,
    token_endpoint_auth_method: str | None,
) -> tuple[dict[str, str], tuple[str, str] | None]:
    if not client_secret or token_endpoint_auth_method == "none":
        return data, None
    method = token_endpoint_auth_method or "client_secret_post"
    if method == "client_secret_post":
        return {**data, "client_id": client_id, "client_secret": client_secret}, None
    if method == "client_secret_basic":
        return data, (client_id, client_secret)
    raise IntegrationOAuthProviderError(
        "unsupported_client_auth",
        "OAuth provider uses an unsupported client authentication method.",
    )


async def revoke_token(
    *,
    revocation_endpoint: str,
    issuer: str,
    token_endpoint: str,
    token: str,
    token_type_hint: str,
    client_id: str,
    client_secret: str | None,
    token_endpoint_auth_method: str | None,
    provider_namespace: str,
) -> None:
    """Revoke one token; a repeated successful request is treated as success."""

    pinned_address = await validate_revocation_endpoint_destination(
        revocation_endpoint=revocation_endpoint,
        issuer=issuer,
        token_endpoint=token_endpoint,
    )
    endpoint_url = httpx.URL(revocation_endpoint)
    pinned_url = endpoint_url.copy_with(host=pinned_address)
    request_headers = {"Host": endpoint_url.netloc.decode("ascii")}
    request_extensions = {"sni_hostname": endpoint_url.raw_host.decode("ascii")}
    data = {"token": token}
    auth: tuple[str, str] | None = None
    if provider_namespace != "slack":
        data["token_type_hint"] = token_type_hint
        data, auth = _auth_options(
            data,
            client_id=client_id,
            client_secret=client_secret,
            token_endpoint_auth_method=token_endpoint_auth_method,
        )
        if client_id and "client_id" not in data and auth is None:
            data["client_id"] = client_id
    try:
        async with httpx.AsyncClient(
            timeout=20.0,
            follow_redirects=False,
            trust_env=False,
        ) as client:
            response = await client.post(
                pinned_url,
                data=data,
                auth=auth,
                headers=request_headers,
                extensions=request_extensions,
            )
            response.raise_for_status()
            if provider_namespace == "slack":
                payload = response.json()
                if not isinstance(payload, dict) or payload.get("ok") is not True:
                    raise IntegrationOAuthProviderError(
                        "revocation_rejected",
                        "OAuth provider rejected token revocation.",
                    )
    except IntegrationOAuthProviderError:
        raise
    except (httpx.HTTPError, ValueError) as exc:
        raise IntegrationOAuthProviderError(
            "revocation_failed",
            "OAuth provider token revocation failed.",
        ) from exc
