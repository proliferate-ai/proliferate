"""Agent auth selection persistence (per user/harness/surface wiring rows).

DB-coherence that the SQL CHECKs cannot express (api_key ownership + active
status, no duplicate source within a scope) is enforced here; callers get
typed ValueErrors. Per-harness enabled-set legality (cardinality, env-var
shape, gateway capability) lives one layer up in the server validator
(``server/cloud/agent_gateway/selection_rules.py``), which the write endpoint
runs before calling ``put_auth_selections``.
"""

from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.agent_gateway import (
    AGENT_API_KEY_STATUS_ACTIVE,
    AGENT_AUTH_HARNESS_KINDS,
    AGENT_AUTH_SOURCE_API_KEY,
    AGENT_AUTH_SOURCE_KINDS,
    AGENT_AUTH_SURFACES,
)
from proliferate.db.models.cloud.agent_gateway import AgentApiKey, AgentAuthSelection
from proliferate.db.store.agent_gateway.mappers import selection_record
from proliferate.db.store.agent_gateway.records import (
    AgentAuthSelectionRecord,
    DesiredAuthSource,
)
from proliferate.utils.time import utcnow

# A source is identified within a scope by (source_kind, env_var_name); this is
# the scope UNIQUE minus (user, harness, surface). Gateway rows share the
# (gateway, None) identity, so at most one may exist per scope.
_SourceKey = tuple[str, str | None]


def _source_key(source_kind: str, env_var_name: str | None) -> _SourceKey:
    return (source_kind, env_var_name)


class AgentApiKeyNotUsableError(ValueError):
    """A referenced api key is not an active key owned by the caller."""


def _validate_source(*, surface: str, source: DesiredAuthSource) -> None:
    if surface not in AGENT_AUTH_SURFACES:
        raise ValueError(f"Unknown agent auth surface: {surface}")
    if source.source_kind not in AGENT_AUTH_SOURCE_KINDS:
        raise ValueError(f"Unknown agent auth source kind: {source.source_kind}")
    if source.source_kind == AGENT_AUTH_SOURCE_API_KEY:
        if source.api_key_id is None or source.env_var_name is None:
            raise ValueError("An api_key source requires both api_key_id and env_var_name.")
    else:  # gateway
        if source.api_key_id is not None or source.env_var_name is not None:
            raise ValueError("A gateway source must not carry an api_key_id or env_var_name.")


async def _assert_keys_usable(
    db: AsyncSession,
    *,
    user_id: UUID,
    api_key_ids: set[UUID],
) -> None:
    if not api_key_ids:
        return
    usable = set(
        (
            await db.execute(
                select(AgentApiKey.id).where(
                    AgentApiKey.id.in_(api_key_ids),
                    AgentApiKey.user_id == user_id,
                    AgentApiKey.status == AGENT_API_KEY_STATUS_ACTIVE,
                )
            )
        )
        .scalars()
        .all()
    )
    if usable != api_key_ids:
        raise AgentApiKeyNotUsableError(
            "api_key_id must reference an active key owned by the user."
        )


async def put_auth_selections(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    surface: str,
    sources: Sequence[DesiredAuthSource],
) -> list[AgentAuthSelectionRecord]:
    """Replace a scope's selection rows with ``sources`` (full desired state).

    Existing rows keyed by (source_kind, env_var_name) are updated in place,
    absent ones deleted, and new ones inserted — so row ids and created_at
    survive across edits. Structural coherence (source shape, key ownership,
    no duplicate source) is enforced; per-harness legality is the caller's.
    """
    if harness_kind not in AGENT_AUTH_HARNESS_KINDS:
        raise ValueError(f"Unknown agent harness kind: {harness_kind}")

    desired: dict[_SourceKey, DesiredAuthSource] = {}
    referenced_key_ids: set[UUID] = set()
    for source in sources:
        _validate_source(surface=surface, source=source)
        key = _source_key(source.source_kind, source.env_var_name)
        if key in desired:
            raise ValueError(
                "Duplicate selection source for "
                f"(source_kind={source.source_kind!r}, env_var_name={source.env_var_name!r})."
            )
        desired[key] = source
        if source.api_key_id is not None:
            referenced_key_ids.add(source.api_key_id)

    await _assert_keys_usable(db, user_id=user_id, api_key_ids=referenced_key_ids)

    existing_rows = (
        (
            await db.execute(
                select(AgentAuthSelection).where(
                    AgentAuthSelection.user_id == user_id,
                    AgentAuthSelection.harness_kind == harness_kind,
                    AgentAuthSelection.surface == surface,
                )
            )
        )
        .scalars()
        .all()
    )
    existing = {_source_key(row.source_kind, row.env_var_name): row for row in existing_rows}

    now = utcnow()
    for key, row in existing.items():
        if key not in desired:
            await db.delete(row)

    for key, source in desired.items():
        row = existing.get(key)
        if row is None:
            db.add(
                AgentAuthSelection(
                    user_id=user_id,
                    harness_kind=harness_kind,
                    surface=surface,
                    source_kind=source.source_kind,
                    api_key_id=source.api_key_id,
                    env_var_name=source.env_var_name,
                    provider_hint=source.provider_hint,
                    enabled=source.enabled,
                    created_at=now,
                    updated_at=now,
                )
            )
            continue
        if (
            row.api_key_id != source.api_key_id
            or row.provider_hint != source.provider_hint
            or row.enabled != source.enabled
        ):
            row.api_key_id = source.api_key_id
            row.provider_hint = source.provider_hint
            row.enabled = source.enabled
            row.updated_at = now

    await db.flush()
    return await get_scope_auth_selections(
        db, user_id=user_id, harness_kind=harness_kind, surface=surface
    )


async def get_scope_auth_selections(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    surface: str,
) -> list[AgentAuthSelectionRecord]:
    """All rows (enabled or not) for one (user, harness, surface) scope."""
    rows = (
        (
            await db.execute(
                select(AgentAuthSelection)
                .where(
                    AgentAuthSelection.user_id == user_id,
                    AgentAuthSelection.harness_kind == harness_kind,
                    AgentAuthSelection.surface == surface,
                )
                .order_by(
                    AgentAuthSelection.source_kind,
                    AgentAuthSelection.env_var_name,
                )
            )
        )
        .scalars()
        .all()
    )
    return [selection_record(row) for row in rows]


async def list_auth_selections(
    db: AsyncSession,
    *,
    user_id: UUID,
    surface: str | None = None,
) -> list[AgentAuthSelectionRecord]:
    """Every selection row for a user (optionally one surface), enabled or not."""
    query = select(AgentAuthSelection).where(AgentAuthSelection.user_id == user_id)
    if surface is not None:
        query = query.where(AgentAuthSelection.surface == surface)
    rows = (
        (
            await db.execute(
                query.order_by(
                    AgentAuthSelection.harness_kind,
                    AgentAuthSelection.surface,
                    AgentAuthSelection.source_kind,
                    AgentAuthSelection.env_var_name,
                )
            )
        )
        .scalars()
        .all()
    )
    return [selection_record(row) for row in rows]


async def list_enabled_auth_selections(
    db: AsyncSession,
    *,
    user_id: UUID,
    surface: str,
    harness_kind: str | None = None,
) -> list[AgentAuthSelectionRecord]:
    """Enabled rows only, for the renderer (disabled rows never leave the DB)."""
    query = select(AgentAuthSelection).where(
        AgentAuthSelection.user_id == user_id,
        AgentAuthSelection.surface == surface,
        AgentAuthSelection.enabled.is_(True),
    )
    if harness_kind is not None:
        query = query.where(AgentAuthSelection.harness_kind == harness_kind)
    rows = (
        (
            await db.execute(
                query.order_by(
                    AgentAuthSelection.harness_kind,
                    AgentAuthSelection.source_kind,
                    AgentAuthSelection.env_var_name,
                )
            )
        )
        .scalars()
        .all()
    )
    return [selection_record(row) for row in rows]


async def list_enabled_selections_referencing_key(
    db: AsyncSession,
    *,
    user_id: UUID,
    api_key_id: UUID,
) -> list[AgentAuthSelectionRecord]:
    """Enabled rows that wire ``api_key_id`` — blocks revoking a live key."""
    rows = (
        (
            await db.execute(
                select(AgentAuthSelection)
                .where(
                    AgentAuthSelection.user_id == user_id,
                    AgentAuthSelection.api_key_id == api_key_id,
                    AgentAuthSelection.enabled.is_(True),
                )
                .order_by(
                    AgentAuthSelection.harness_kind,
                    AgentAuthSelection.surface,
                )
            )
        )
        .scalars()
        .all()
    )
    return [selection_record(row) for row in rows]


async def clear_auth_selections(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    surface: str,
) -> int:
    """Delete every row for a scope (back to the native empty state)."""
    result = await db.execute(
        delete(AgentAuthSelection).where(
            AgentAuthSelection.user_id == user_id,
            AgentAuthSelection.harness_kind == harness_kind,
            AgentAuthSelection.surface == surface,
        )
    )
    return result.rowcount or 0
