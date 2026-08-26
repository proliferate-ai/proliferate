"""Resolve a ready integration account into concrete MCP request material.

:func:`ensure_provider_access` turns an account's stored credential bundle plus
its definition's config into the HTTP headers / query params needed to talk to
the provider's MCP endpoint, refreshing an OAuth access token in place when it
is missing or about to expire. :func:`resolve_launch` additionally renders the
endpoint URL so callers get a launch-ready ``(url, headers, query)`` triple.

Credential bundles (see ``proliferate.lib.infra.encryption.json``):
  - ``secret-fields-v1`` -> ``{"secretFields": {"<id>": "<value>", ...}}``
  - ``oauth-bundle-v1``  -> ``{issuer, resource, clientId, accessToken,
    refreshToken, expiresAt, scopes, tokenEndpoint, redirectUri}``
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db import session_ops
from proliferate.db.store.integrations.accounts import (
    compare_and_swap_oauth_refresh,
    get_account,
)
from proliferate.db.store.integrations.oauth_clients import (
    get_oauth_client,
    get_oauth_client_by_id,
)
from proliferate.integrations.integration_oauth.tokens import refresh_token
from proliferate.lib.infra.encryption.fernet import decrypt_text
from proliferate.lib.infra.encryption.json import decrypt_json, encrypt_json
from proliferate.lib.infra.time.wall_clock import utcnow
from proliferate.server.api_errors import CloudApiError
from proliferate.server.integration_gateway.connections.config import (
    HeaderTemplate,
    IntegrationConfig,
    QueryTemplate,
    parse_definition_config,
    render_mcp_url,
)
from proliferate.server.integration_gateway.connections.oauth.scope_policy import (
    OAuthScopePolicyError,
    normalize_oauth_scopes,
    resolve_refreshed_oauth_scopes,
    validate_stored_oauth_scopes,
)

if TYPE_CHECKING:
    from proliferate.db.store.integrations.accounts import IntegrationAccountRecord
    from proliferate.db.store.integrations.definitions import IntegrationDefinitionRecord

# Refresh an OAuth token a minute before it actually expires to avoid racing the
# clock against in-flight requests.
_EXPIRY_SKEW = timedelta(seconds=60)

_PLACEHOLDER_RE = re.compile(r"\{(settings|secret)\.([A-Za-z0-9_.:-]+)\}")
_CRLF_RE = re.compile(r"[\r\n]")


@dataclass(frozen=True)
class ProviderAccess:
    """Concrete request material for one integration account."""

    headers: dict[str, str]
    query: dict[str, str]
    token_expires_at: datetime | None


def render_candidate_api_key_launch(
    cfg: IntegrationConfig,
    *,
    secret_fields: dict[str, str],
    settings: dict[str, object],
) -> tuple[str, dict[str, str], dict[str, str]]:
    """Render validation-only request material for staged API-key credentials."""

    return (
        render_mcp_url(cfg, settings),
        _render_headers(cfg.headers, secrets=secret_fields, settings=settings),
        _render_query(cfg.query, secrets=secret_fields, settings=settings),
    )


# --------------------------------------------------------------------------- #
# Template rendering ({secret.X} / {settings.X})
# --------------------------------------------------------------------------- #


def _stringify(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _render_template_value(
    template: str,
    *,
    secrets: dict[str, str],
    settings: dict[str, Any],
    optional: bool,
) -> str | None:
    """Substitute ``{secret.X}`` / ``{settings.X}`` placeholders in ``template``.

    Returns ``None`` when an optional template has a missing input; raises for a
    required template with a missing input or an unsupported placeholder.
    """
    missing = False

    def replace(match: re.Match[str]) -> str:
        nonlocal missing
        source, key = match.group(1), match.group(2)
        if source == "settings":
            if key not in settings:
                missing = True
                return ""
            return _stringify(settings[key])
        if key not in secrets:
            missing = True
            return ""
        return secrets[key]

    rendered = _PLACEHOLDER_RE.sub(replace, template)
    if "{" in rendered or "}" in rendered:
        raise CloudApiError(
            "integration_config_invalid",
            "Integration config contained an unsupported template placeholder.",
            status_code=500,
        )
    if missing or (optional and rendered == ""):
        if optional:
            return None
        raise CloudApiError(
            "integration_config_invalid",
            "Integration config required a value that was not available.",
            status_code=400,
        )
    return rendered


def _render_headers(
    templates: tuple[HeaderTemplate, ...],
    *,
    secrets: dict[str, str],
    settings: dict[str, Any],
) -> dict[str, str]:
    headers: dict[str, str] = {}
    for template in templates:
        rendered = _render_template_value(
            template.value, secrets=secrets, settings=settings, optional=template.optional
        )
        if rendered is None:
            continue
        if _CRLF_RE.search(template.name) or _CRLF_RE.search(rendered):
            raise CloudApiError(
                "integration_config_invalid",
                "Integration config produced an invalid header.",
                status_code=500,
            )
        headers[template.name] = rendered
    return headers


def _render_query(
    templates: tuple[QueryTemplate, ...],
    *,
    secrets: dict[str, str],
    settings: dict[str, Any],
) -> dict[str, str]:
    query: dict[str, str] = {}
    for template in templates:
        rendered = _render_template_value(
            template.value, secrets=secrets, settings=settings, optional=template.optional
        )
        if rendered is None:
            continue
        query[template.name] = rendered
    return query


# --------------------------------------------------------------------------- #
# Bundle helpers
# --------------------------------------------------------------------------- #


def _parse_settings(settings_json: str) -> dict[str, Any]:
    try:
        value = json.loads(settings_json or "{}")
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def _decode_bundle(account: IntegrationAccountRecord) -> dict[str, Any]:
    if not account.credential_ciphertext:
        raise CloudApiError(
            "integration_setup_required",
            "Integration account has no stored credentials.",
            status_code=400,
        )
    try:
        return decrypt_json(account.credential_ciphertext, secret=settings.cloud_secret_key)
    except Exception as exc:  # noqa: BLE001 - crypto/JSON failures collapse to one error
        raise CloudApiError(
            "integration_credentials_unreadable",
            "Integration credentials could not be decrypted.",
            status_code=500,
        ) from exc


def _parse_expires_at(raw: object) -> datetime | None:
    if not raw:
        return None
    if isinstance(raw, datetime):
        value = raw
    else:
        try:
            value = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except ValueError:
            return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value


def _bundle_scopes(bundle: dict[str, Any]) -> tuple[str, ...]:
    raw = bundle.get("scopes")
    if isinstance(raw, str | list | tuple):
        return normalize_oauth_scopes(raw)
    return ()


def _scope_policy_reauth() -> CloudApiError:
    return CloudApiError(
        "integration_reauth_required",
        "Integration requires re-authentication.",
        status_code=401,
    )


def _grant_changed() -> CloudApiError:
    return CloudApiError(
        "integration_grant_changed",
        "Integration authority changed; retry the operation.",
        status_code=409,
    )


# --------------------------------------------------------------------------- #
# OAuth token refresh
# --------------------------------------------------------------------------- #


async def _refresh_oauth_bundle(
    *,
    account: IntegrationAccountRecord,
    bundle: dict[str, Any],
    cfg: IntegrationConfig,
    provider_namespace: str,
) -> tuple[str, datetime | None]:
    """Refresh the access token in ``bundle`` and persist the new credential.

    Returns ``(access_token, expires_at)``. Raises ``integration_reauth_required``
    when no refresh token is available or the provider rejects the refresh.

    Manages its own short-lived DB sessions so no pooled connection is held
    across the provider round-trip — a slow token endpoint must not pin a
    connection (and a handful of concurrent refreshes must not exhaust the
    pool). It also commits the refreshed bundle independently: providers may
    rotate the refresh token, so the new credential has to persist no matter
    what the surrounding request does.
    """
    refresh_value = bundle.get("refreshToken")
    token_endpoint = bundle.get("tokenEndpoint")
    if not refresh_value or not token_endpoint:
        raise CloudApiError(
            "integration_reauth_required",
            "Integration requires re-authentication.",
            status_code=401,
        )

    client_secret: str | None = None
    token_endpoint_auth_method: str | None = None
    issuer = bundle.get("issuer")
    redirect_uri = bundle.get("redirectUri")
    if issuer and redirect_uri:
        # Read (and close) before the network call so the connection is back
        # in the pool while we wait on the provider.
        async with session_ops.open_async_session() as read_db:
            oauth_client = (
                await get_oauth_client_by_id(read_db, account.provider_client_id)
                if account.provider_client_id is not None
                else await get_oauth_client(
                    read_db,
                    str(issuer),
                    str(redirect_uri),
                    account.definition_id,
                )
            )
        if oauth_client is not None:
            if (
                oauth_client.definition_id != account.definition_id
                or oauth_client.issuer != str(issuer)
                or oauth_client.redirect_uri != str(redirect_uri)
                or (oauth_client.resource or "") != str(bundle.get("resource") or "")
                or oauth_client.client_id != str(bundle.get("clientId", ""))
            ):
                raise _scope_policy_reauth()
            token_endpoint_auth_method = oauth_client.token_endpoint_auth_method
            if oauth_client.client_secret_ciphertext:
                client_secret = decrypt_text(
                    oauth_client.client_secret_ciphertext, secret=settings.cloud_secret_key
                )

    try:
        token = await refresh_token(
            token_endpoint=str(token_endpoint),
            client_id=str(bundle.get("clientId", "")),
            refresh_token_value=str(refresh_value),
            resource=str(bundle.get("resource") or ""),
            client_secret=client_secret,
            token_endpoint_auth_method=token_endpoint_auth_method,
            provider_namespace=provider_namespace,
        )
    except CloudApiError:
        raise
    except Exception as exc:  # noqa: BLE001 - any refresh failure -> reauth
        raise CloudApiError(
            "integration_reauth_required",
            "Integration requires re-authentication.",
            status_code=401,
        ) from exc

    access_token = token.access_token
    if not access_token:
        raise CloudApiError(
            "integration_reauth_required",
            "OAuth provider did not return an access token.",
            status_code=401,
        )
    new_refresh = token.refresh_token or refresh_value
    expires_at = _parse_expires_at(token.expires_at)
    try:
        scopes = resolve_refreshed_oauth_scopes(
            reported_scopes=token.scopes,
            stored_scopes=_bundle_scopes(bundle),
            configured_scopes=cfg.oauth_scopes,
            scope_policy=cfg.oauth_scope_policy,
        )
    except OAuthScopePolicyError as exc:
        raise _scope_policy_reauth() from exc

    stored_scopes = _bundle_scopes(bundle)
    stored_scope_set = set(stored_scopes)
    refreshed_scope_set = set(scopes)
    if refreshed_scope_set - stored_scope_set:
        # A refresh may preserve or narrow authority, never silently expand it.
        # Legacy empty metadata is unknown authority, so a newly reported scope
        # set also requires explicit reauthorization instead of being trusted.
        raise _scope_policy_reauth()
    grant_changed = refreshed_scope_set != stored_scope_set
    # Scope order carries no authority. Preserve the committed order to avoid
    # grant churn when a provider returns the same set in a different order.
    scopes = tuple(scope for scope in stored_scopes if scope in refreshed_scope_set)
    new_bundle = {
        **bundle,
        "accessToken": access_token,
        "refreshToken": new_refresh,
        "expiresAt": expires_at.isoformat() if expires_at is not None else None,
        "scopes": list(scopes),
    }
    effective_scopes_json = json.dumps(list(scopes), separators=(",", ":"))
    # Fresh session for the write: exact grant + credential revisions ensure a
    # disconnect, replacement, or concurrent refresh can never be overwritten.
    async with session_ops.open_async_session() as write_db:
        updated = await compare_and_swap_oauth_refresh(
            write_db,
            account_id=account.id,
            expected_grant_version=account.grant_version,
            expected_credential_version=account.credential_version,
            expected_definition_security_revision_id=(account.definition_security_revision_id),
            expected_provider_client_id=account.provider_client_id,
            credential_ciphertext=encrypt_json(new_bundle, secret=settings.cloud_secret_key),
            token_expires_at=expires_at,
            effective_scopes_json=effective_scopes_json,
            advance_grant=grant_changed,
        )
        await session_ops.commit_session(write_db)
    if updated is not None:
        if grant_changed:
            # The provider legitimately narrowed authority. Persist it, then
            # force the caller through a fresh operation admission.
            raise _grant_changed()
        return access_token, expires_at

    # Another refresher may have won. Reuse only an exact committed winner;
    # never replay a rotated/disconnected grant under this admission.
    async with session_ops.open_async_session() as read_db:
        winner = await get_account(read_db, account.id)
    if winner is None or not winner.enabled or winner.status != "ready":
        raise _scope_policy_reauth()
    if (
        winner.grant_version != account.grant_version
        or winner.definition_security_revision_id != account.definition_security_revision_id
        or winner.provider_client_id != account.provider_client_id
    ):
        raise _grant_changed()
    if winner.credential_version <= account.credential_version:
        raise _scope_policy_reauth()
    winner_bundle = _decode_bundle(winner)
    try:
        validate_stored_oauth_scopes(
            stored_scopes=_bundle_scopes(winner_bundle),
            configured_scopes=cfg.oauth_scopes,
            scope_policy=cfg.oauth_scope_policy,
        )
    except OAuthScopePolicyError as exc:
        raise _scope_policy_reauth() from exc
    winner_token = winner_bundle.get("accessToken")
    winner_expiry = _parse_expires_at(winner_bundle.get("expiresAt"))
    if not winner_token or (
        winner_expiry is not None and winner_expiry <= utcnow() + _EXPIRY_SKEW
    ):
        raise _scope_policy_reauth()
    return str(winner_token), winner_expiry


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #


async def ensure_provider_access(
    db: AsyncSession,
    *,
    account_record: IntegrationAccountRecord,
    definition_record: IntegrationDefinitionRecord,
) -> ProviderAccess:
    """Resolve request headers/query for ``account_record``, refreshing OAuth.

    - ``none``    -> empty headers/query.
    - ``api_key`` -> render config templates against the ``secret-fields-v1``
      bundle (``{secret.<id>}``) and account settings (``{settings.<id>}``),
      including any static headers (e.g. Neon's ``x-read-only``).
    - ``oauth2``  -> use the ``oauth-bundle-v1`` access token (refreshing it when
      absent or within the expiry skew) and render config templates, ensuring an
      ``Authorization: Bearer`` header is present.

    ``db`` is kept for signature stability but no longer touched: a token
    refresh manages its own short-lived sessions (see ``_refresh_oauth_bundle``)
    so the caller's session never spans the provider round-trip.
    """
    cfg = parse_definition_config(definition_record.config_json)
    auth_kind = definition_record.auth_kind
    settings = _parse_settings(account_record.settings_json)

    if auth_kind == "none":
        return ProviderAccess(headers={}, query={}, token_expires_at=None)

    if auth_kind == "api_key":
        return _api_key_access(cfg, account_record, settings)

    if auth_kind == "oauth2":
        return await _oauth_access(
            cfg,
            account_record,
            settings,
            provider_namespace=definition_record.namespace,
        )

    raise CloudApiError(
        "integration_auth_kind_unsupported",
        f"Unsupported integration auth kind: {auth_kind!r}.",
        status_code=500,
    )


def _api_key_access(
    cfg: IntegrationConfig,
    account: IntegrationAccountRecord,
    settings: dict[str, Any],
) -> ProviderAccess:
    bundle = _decode_bundle(account)
    raw_secret_fields = bundle.get("secretFields")
    secrets: dict[str, str] = {}
    if isinstance(raw_secret_fields, dict):
        secrets = {str(k): _stringify(v) for k, v in raw_secret_fields.items()}
    headers = _render_headers(cfg.headers, secrets=secrets, settings=settings)
    query = _render_query(cfg.query, secrets=secrets, settings=settings)
    return ProviderAccess(headers=headers, query=query, token_expires_at=None)


async def _oauth_access(
    cfg: IntegrationConfig,
    account: IntegrationAccountRecord,
    settings: dict[str, Any],
    *,
    provider_namespace: str,
) -> ProviderAccess:
    bundle = _decode_bundle(account)
    try:
        validate_stored_oauth_scopes(
            stored_scopes=_bundle_scopes(bundle),
            configured_scopes=cfg.oauth_scopes,
            scope_policy=cfg.oauth_scope_policy,
        )
    except OAuthScopePolicyError as exc:
        raise _scope_policy_reauth() from exc
    access_token = bundle.get("accessToken")
    expires_at = _parse_expires_at(bundle.get("expiresAt"))
    now = utcnow()

    if access_token and (expires_at is None or expires_at > now + _EXPIRY_SKEW):
        resolved_token = str(access_token)
        resolved_expiry = expires_at
    else:
        resolved_token, resolved_expiry = await _refresh_oauth_bundle(
            account=account,
            bundle=bundle,
            cfg=cfg,
            provider_namespace=provider_namespace,
        )

    # Expose bundle string fields (plus the resolved access token) as secrets so
    # config templates like ``Bearer {secret.accessToken}`` render correctly.
    secrets: dict[str, str] = {
        str(k): _stringify(v) for k, v in bundle.items() if isinstance(v, str | int | float | bool)
    }
    secrets["accessToken"] = resolved_token

    headers = _render_headers(cfg.headers, secrets=secrets, settings=settings)
    query = _render_query(cfg.query, secrets=secrets, settings=settings)

    if not any(name.lower() == "authorization" for name in headers):
        headers["Authorization"] = f"Bearer {resolved_token}"

    return ProviderAccess(headers=headers, query=query, token_expires_at=resolved_expiry)


async def resolve_launch(
    db: AsyncSession,
    account_record: IntegrationAccountRecord,
    definition_record: IntegrationDefinitionRecord,
) -> tuple[str, dict[str, str], dict[str, str]]:
    """Render the launch-ready ``(url, headers, query)`` for an account."""
    cfg = parse_definition_config(definition_record.config_json)
    settings = _parse_settings(account_record.settings_json)
    url = render_mcp_url(cfg, settings)
    access = await ensure_provider_access(
        db, account_record=account_record, definition_record=definition_record
    )
    return url, access.headers, access.query
