"""Integration health: what's connected, and what needs the user's attention.

For each definition visible to the user we compute a single health verdict by
combining org policy, the user's account state, and — for OAuth accounts that
claim to be ready — an active credential probe so a silently-expired token
surfaces as ``needs_reauth`` rather than failing mid-session.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import session_ops
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.db.store.integrations import policies as policies_store
from proliferate.db.store.integrations import tool_cache as tool_cache_store
from proliferate.db.store.integrations.accounts import IntegrationAccountRecord
from proliferate.db.store.integrations.definitions import IntegrationDefinitionRecord
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integrations.access import ensure_provider_access


class HealthVerdict(StrEnum):
    """Health verdicts, in rough "needs attention" order."""

    READY = "ready"
    NEEDS_AUTH = "needs_auth"
    NEEDS_REAUTH = "needs_reauth"
    DISABLED_BY_USER = "disabled_by_user"
    DISABLED_BY_ORG = "disabled_by_org"
    ERROR = "error"


@dataclass(frozen=True)
class IntegrationHealth:
    definition_id: UUID
    account_id: UUID | None
    namespace: str
    display_name: str
    auth_kind: str
    effective_enabled: bool
    policy_enabled: bool | None
    account_enabled: bool | None
    health: HealthVerdict
    token_expires_at: datetime | None
    tool_count: int | None
    last_error_code: str | None


async def _tool_count(db: AsyncSession, account_id: UUID) -> int | None:
    cache = await tool_cache_store.get_tool_cache(db, account_id)
    if cache is None or cache.status != "ready":
        return None
    try:
        return len(json.loads(cache.tools_json))
    except (ValueError, TypeError):
        return None


async def _account_health(
    db: AsyncSession,
    *,
    account: IntegrationAccountRecord,
    definition: IntegrationDefinitionRecord,
) -> tuple[HealthVerdict, str | None]:
    """Return (health, last_error_code) for an existing account."""
    if not account.enabled:
        return HealthVerdict.DISABLED_BY_USER, account.last_error_code
    if account.status == "setup_required":
        return HealthVerdict.NEEDS_AUTH, account.last_error_code
    if account.status == "error":
        return HealthVerdict.ERROR, account.last_error_code
    # status == "ready": actively probe OAuth so expired tokens surface early.
    if account.auth_kind == "oauth2":
        try:
            await ensure_provider_access(db, account_record=account, definition_record=definition)
        except CloudApiError as exc:
            if exc.code == "integration_reauth_required":
                return HealthVerdict.NEEDS_REAUTH, exc.code
            return HealthVerdict.ERROR, exc.code
    return HealthVerdict.READY, None


async def _probe_account_health(
    *,
    account: IntegrationAccountRecord,
    definition: IntegrationDefinitionRecord,
) -> tuple[HealthVerdict, str | None]:
    """Run one account probe on its own session so probes can run concurrently.

    An ``AsyncSession`` is not concurrency-safe and the OAuth probe both reads
    (oauth client) and writes (a refreshed token bundle), so each probe gets a
    dedicated session and commits it — a refreshed token should persist no
    matter what the surrounding request does.
    """
    async with session_ops.open_async_session() as probe_db:
        result = await _account_health(probe_db, account=account, definition=definition)
        await session_ops.commit_session(probe_db)
        return result


async def list_integration_health(
    db: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID | None = None,
) -> list[IntegrationHealth]:
    if organization_id is not None:
        # An org's custom definitions + policy are private to its members; a
        # non-member must not learn about them by supplying the org id.
        membership = await organization_store.get_active_membership(
            db, organization_id=organization_id, user_id=user_id
        )
        if membership is None:
            raise CloudApiError(
                "organization_not_found", "Organization not found.", status_code=404
            )
        definitions = await definitions_store.list_definitions_visible_to_org(db, organization_id)
        policies = {
            policy.definition_id: policy.enabled
            for policy in await policies_store.list_policies_for_org(db, organization_id)
        }
    else:
        definitions = await definitions_store.list_seed_definitions(db)
        policies = {}

    accounts = {
        account.definition_id: account
        for account in await accounts_store.list_accounts_for_user(db, user_id)
    }

    visible = [definition for definition in definitions if definition.archived_at is None]

    def _effective_enabled(definition: IntegrationDefinitionRecord) -> bool:
        policy_enabled = policies.get(definition.id)
        return policy_enabled if policy_enabled is not None else definition.enabled_by_default

    # Account probes are independent (OAuth ones do a network round-trip), so
    # run them concurrently; see _probe_account_health for the session story.
    probe_targets = [
        (definition, account)
        for definition in visible
        if _effective_enabled(definition) and (account := accounts.get(definition.id)) is not None
    ]
    probe_outcomes = await asyncio.gather(
        *(
            _probe_account_health(account=account, definition=definition)
            for definition, account in probe_targets
        )
    )
    probed = {
        definition.id: outcome
        for (definition, _), outcome in zip(probe_targets, probe_outcomes, strict=True)
    }

    items: list[IntegrationHealth] = []
    for definition in visible:
        policy_enabled = policies.get(definition.id)
        effective_enabled = _effective_enabled(definition)
        account = accounts.get(definition.id)

        if not effective_enabled:
            health = HealthVerdict.DISABLED_BY_ORG
            last_error = None
        elif account is None:
            health = HealthVerdict.NEEDS_AUTH
            last_error = None
        else:
            health, last_error = probed[definition.id]

        items.append(
            IntegrationHealth(
                definition_id=definition.id,
                account_id=account.id if account else None,
                namespace=definition.namespace,
                display_name=definition.display_name,
                auth_kind=definition.auth_kind,
                effective_enabled=effective_enabled,
                policy_enabled=policy_enabled,
                account_enabled=account.enabled if account else None,
                health=health,
                token_expires_at=account.token_expires_at if account else None,
                tool_count=await _tool_count(db, account.id) if account else None,
                last_error_code=last_error,
            )
        )
    return items
