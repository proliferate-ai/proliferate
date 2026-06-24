"""OIDC protocol helpers for SSO."""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import urlencode, urlparse

import httpx
from fastapi import HTTPException, status
from jose import JWTError, jwt

from proliferate.auth.identity import providers
from proliferate.auth.identity.service import hash_secret
from proliferate.auth.sso.policy import oidc_discovery_url
from proliferate.auth.sso.types import SsoConnectionSnapshot, VerifiedSsoIdentity
from proliferate.config import settings

OIDC_SIGNING_ALGORITHMS = [
    "RS256",
    "RS384",
    "RS512",
    "ES256",
    "ES384",
    "ES512",
]


@dataclass(frozen=True)
class OidcMetadata:
    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    jwks_uri: str
    userinfo_endpoint: str | None


@dataclass(frozen=True)
class OidcTokenResponse:
    access_token: str | None
    id_token: str
    refresh_token: str | None
    expires_at: datetime | None
    scopes: frozenset[str]


async def resolve_oidc_metadata(connection: SsoConnectionSnapshot) -> OidcMetadata:
    if (
        connection.oidc_issuer_url
        and connection.oidc_authorization_endpoint
        and connection.oidc_token_endpoint
        and connection.oidc_jwks_uri
    ):
        await _validate_oidc_url(connection.oidc_authorization_endpoint, "authorization_endpoint")
        await _validate_oidc_url(connection.oidc_token_endpoint, "token_endpoint")
        await _validate_oidc_url(connection.oidc_jwks_uri, "jwks_uri")
        if connection.oidc_userinfo_endpoint:
            await _validate_oidc_url(connection.oidc_userinfo_endpoint, "userinfo_endpoint")
        return OidcMetadata(
            issuer=connection.oidc_issuer_url,
            authorization_endpoint=connection.oidc_authorization_endpoint,
            token_endpoint=connection.oidc_token_endpoint,
            jwks_uri=connection.oidc_jwks_uri,
            userinfo_endpoint=connection.oidc_userinfo_endpoint,
        )

    source_url = connection.oidc_discovery_url or connection.oidc_issuer_url
    if not source_url:
        raise HTTPException(status_code=400, detail="OIDC issuer or discovery URL is required.")
    discovery_url = oidc_discovery_url(source_url)
    await _validate_oidc_url(discovery_url, "discovery_url")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(discovery_url)
            response.raise_for_status()
            payload = response.json()
    except (ValueError, httpx.HTTPError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OIDC discovery metadata could not be loaded.",
        ) from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="OIDC discovery metadata is invalid.")

    issuer = _required_string(payload, "issuer")
    authorization_endpoint = _required_string(payload, "authorization_endpoint")
    token_endpoint = _required_string(payload, "token_endpoint")
    jwks_uri = _required_string(payload, "jwks_uri")
    userinfo_endpoint = payload.get("userinfo_endpoint")
    metadata = OidcMetadata(
        issuer=issuer,
        authorization_endpoint=authorization_endpoint,
        token_endpoint=token_endpoint,
        jwks_uri=jwks_uri,
        userinfo_endpoint=userinfo_endpoint if isinstance(userinfo_endpoint, str) else None,
    )
    await _validate_oidc_url(metadata.authorization_endpoint, "authorization_endpoint")
    await _validate_oidc_url(metadata.token_endpoint, "token_endpoint")
    await _validate_oidc_url(metadata.jwks_uri, "jwks_uri")
    if metadata.userinfo_endpoint:
        await _validate_oidc_url(metadata.userinfo_endpoint, "userinfo_endpoint")
    return metadata


def build_oidc_authorization_url(
    *,
    metadata: OidcMetadata,
    client_id: str,
    redirect_uri: str,
    scopes: tuple[str, ...],
    state: str,
    nonce: str,
    login_hint: str | None,
    prompt: str | None,
) -> str:
    params: dict[str, str] = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(scopes),
        "state": state,
        "nonce": nonce,
    }
    if login_hint:
        params["login_hint"] = login_hint
    if prompt:
        params["prompt"] = prompt
    return f"{metadata.authorization_endpoint}?" + urlencode(params)


async def exchange_oidc_code(
    *,
    metadata: OidcMetadata,
    client_id: str,
    client_secret: str | None,
    token_endpoint_auth_method: str,
    code: str,
    redirect_uri: str,
) -> OidcTokenResponse:
    data: dict[str, str] = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
    }
    auth: httpx.Auth | tuple[str, str] | None = None
    auth_method = token_endpoint_auth_method or "client_secret_basic"
    if auth_method == "client_secret_basic":
        if not client_secret:
            raise HTTPException(status_code=400, detail="OIDC client secret is required.")
        auth = (client_id, client_secret)
    elif auth_method == "client_secret_post":
        data["client_id"] = client_id
        if client_secret:
            data["client_secret"] = client_secret
    elif auth_method == "none":
        data["client_id"] = client_id
    else:
        raise HTTPException(status_code=400, detail="Unsupported OIDC token auth method.")
    await _validate_oidc_url(metadata.token_endpoint, "token_endpoint")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(metadata.token_endpoint, data=data, auth=auth)
            response.raise_for_status()
            payload = response.json()
    except (ValueError, httpx.HTTPError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OIDC token exchange failed.",
        ) from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="OIDC token response is invalid.")
    id_token = payload.get("id_token")
    if not isinstance(id_token, str) or not id_token:
        raise HTTPException(status_code=400, detail="OIDC token response is missing id_token.")
    access_token = payload.get("access_token")
    refresh_token = payload.get("refresh_token")
    expires_in = payload.get("expires_in")
    expires_at = None
    if isinstance(expires_in, int | float):
        expires_at = datetime.fromtimestamp(datetime.now(UTC).timestamp() + expires_in, tz=UTC)
    return OidcTokenResponse(
        access_token=access_token if isinstance(access_token, str) else None,
        id_token=id_token,
        refresh_token=refresh_token if isinstance(refresh_token, str) else None,
        expires_at=expires_at,
        scopes=providers.parse_scope_string(payload.get("scope")),
    )


async def verify_oidc_identity(
    *,
    connection: SsoConnectionSnapshot,
    metadata: OidcMetadata,
    token: OidcTokenResponse,
    nonce_hash: str,
) -> VerifiedSsoIdentity:
    claims = await _decode_oidc_id_token(
        id_token=token.id_token,
        jwks_uri=metadata.jwks_uri,
        issuer=metadata.issuer,
        audience=connection.oidc_client_id or "",
        access_token=token.access_token,
    )
    _validate_nonce(claims, nonce_hash)
    if claims.get("email") is None and token.access_token and metadata.userinfo_endpoint:
        userinfo = await _fetch_userinfo(metadata.userinfo_endpoint, token.access_token)
        claims = {**userinfo, **claims}
    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject:
        raise HTTPException(status_code=400, detail="OIDC subject is missing.")
    email = claims.get("email") if isinstance(claims.get("email"), str) else None
    display_name = claims.get("name") if isinstance(claims.get("name"), str) else None
    avatar_url = claims.get("picture") if isinstance(claims.get("picture"), str) else None
    email_verified = _claim_bool(claims.get("email_verified"), default=False)
    return VerifiedSsoIdentity(
        provider_subject=subject,
        email=email,
        email_verified=email_verified,
        display_name=display_name,
        avatar_url=avatar_url,
        claims=claims,
    )


async def _decode_oidc_id_token(
    *,
    id_token: str,
    jwks_uri: str,
    issuer: str,
    audience: str,
    access_token: str | None = None,
) -> dict[str, object]:
    await _validate_oidc_url(jwks_uri, "jwks_uri")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(jwks_uri)
            response.raise_for_status()
            jwks = response.json()
    except (ValueError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=400, detail="OIDC JWKS could not be loaded.") from exc
    keys = jwks.get("keys") if isinstance(jwks, dict) else None
    if not isinstance(keys, list):
        raise HTTPException(status_code=400, detail="OIDC JWKS is invalid.")

    # Prefer the key whose kid matches the token header so verification failures surface
    # the real claim error instead of a signature mismatch from an unrelated key.
    try:
        token_kid = jwt.get_unverified_header(id_token).get("kid")
    except JWTError:
        token_kid = None
    candidate_keys = [k for k in keys if isinstance(k, dict)]
    matching = [k for k in candidate_keys if k.get("kid") == token_kid]
    ordered_keys = matching + [k for k in candidate_keys if k not in matching]

    # python-jose validates the `at_hash` claim whenever it is present (Google always
    # includes it), which requires the access token from the code exchange. Pass it so
    # the check can run; skip it only when no access token is available.
    options = {"verify_at_hash": access_token is not None}

    last_error: Exception | None = None
    for key in ordered_keys:
        try:
            claims = jwt.decode(
                id_token,
                key,
                algorithms=OIDC_SIGNING_ALGORITHMS,
                audience=audience,
                issuer=issuer,
                access_token=access_token,
                options=options,
            )
            return dict(claims)
        except JWTError as exc:
            last_error = exc
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="OIDC identity token could not be verified.",
    ) from last_error


async def _fetch_userinfo(userinfo_endpoint: str, access_token: str) -> dict[str, object]:
    await _validate_oidc_url(userinfo_endpoint, "userinfo_endpoint")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                userinfo_endpoint,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            response.raise_for_status()
            payload = response.json()
    except (ValueError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=400, detail="OIDC userinfo request failed.") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="OIDC userinfo response is invalid.")
    return payload


def _validate_nonce(claims: dict[str, object], nonce_hash: str) -> None:
    nonce = claims.get("nonce")
    if not isinstance(nonce, str) or hash_secret(nonce) != nonce_hash:
        raise HTTPException(status_code=400, detail="OIDC nonce mismatch.")


def _required_string(payload: dict[str, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise HTTPException(status_code=400, detail=f"OIDC metadata is missing {key}.")
    return value


def _claim_bool(value: object, *, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in {"true", "1", "yes"}
    return default


async def _validate_oidc_url(value: str, field: str) -> None:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(status_code=400, detail=f"OIDC {field} URL is invalid.")
    if parsed.username or parsed.password or parsed.fragment:
        raise HTTPException(status_code=400, detail=f"OIDC {field} URL is invalid.")
    if settings.telemetry_mode != "hosted_product":
        return
    if parsed.scheme != "https":
        raise HTTPException(status_code=400, detail=f"OIDC {field} URL must use HTTPS.")
    if await _host_resolves_to_private_address(parsed.hostname):
        raise HTTPException(status_code=400, detail=f"OIDC {field} URL host is not allowed.")


async def _host_resolves_to_private_address(hostname: str) -> bool:
    try:
        addrinfo = await asyncio.to_thread(socket.getaddrinfo, hostname, None)
    except socket.gaierror as exc:
        raise HTTPException(
            status_code=400,
            detail="OIDC URL host could not be resolved.",
        ) from exc
    for entry in addrinfo:
        address = entry[4][0]
        try:
            ip = ipaddress.ip_address(address)
        except ValueError:
            return True
        if not ip.is_global:
            return True
    return False
