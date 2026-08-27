"""Agent auth selection persistence (per user/harness/surface wiring rows).

DB-coherence that the SQL CHECKs cannot express (api_key ownership + active
status, no duplicate source within a scope) is enforced here; callers get
typed ValueErrors. Per-harness enabled-set legality (cardinality, env-var
shape, gateway capability) lives one layer up in the server validator
(``server/agent_auth/selection_rules.py``), which the write endpoint
runs before calling ``put_auth_selections``.
"""

from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.agent_gateway import (
    AGENT_API_KEY_KIND_ANTHROPIC_SUBSCRIPTION,
    AGENT_API_KEY_KIND_API_KEY,
    AGENT_API_KEY_STATUS_ACTIVE,
    AGENT_API_KEY_TYPED_KINDS,
    AGENT_AUTH_HARNESS_KINDS,
    AGENT_AUTH_SOURCE_API_KEY,
    AGENT_AUTH_SOURCE_GATEWAY,
    AGENT_AUTH_SOURCE_KINDS,
    AGENT_AUTH_SOURCE_SEAT,
    AGENT_AUTH_SURFACES,
)
from proliferate.db.models.agent_gateway import AgentApiKey, AgentAuthSelection
from proliferate.db.store.agent_gateway.mappers import selection_record
from proliferate.db.store.agent_gateway.records import (
    AgentAuthSelectionRecord,
    DesiredAuthSource,
)
from proliferate.lib.infra.time.wall_clock import utcnow

# A source is identified within a scope by (source_kind, env_var_name), the
# scope UNIQUE minus (user, harness, surface) — plus the referenced vault
# entry for a TYPED api_key source, whose env_var_name is None by law (the
# typed kind carries its own env mapping), so only the entry itself can
# distinguish two typed sources. Gateway rows share the (gateway, None, None)
# identity, so at most one may exist per scope. Seat rows never carry an
# env_var_name either, so the referenced entry is their identity too: the
# pool row is (seat, None, None) and each pin is (seat, None, <entry id>).
_SourceKey = tuple[str, str | None, UUID | None]


def _source_key(
    source_kind: str,
    env_var_name: str | None,
    api_key_id: UUID | None,
) -> _SourceKey:
    if source_kind == AGENT_AUTH_SOURCE_SEAT:
        return (source_kind, None, api_key_id)
    if source_kind == AGENT_AUTH_SOURCE_API_KEY and env_var_name is None:
        return (source_kind, None, api_key_id)
    return (source_kind, env_var_name, None)


class AgentApiKeyNotUsableError(ValueError):
    """A referenced api key is not an active key owned by the caller."""


class AgentProviderConfigNotSupportedError(ValueError):
    """A typed vault entry's kind is not a declared (non-pending) providerConfig
    kind of the target harness — the registry-driven typed refusal
    (agent-auth.md "The vault": the registry names which provider-config kinds
    each harness supports; anything else is rejected at write time)."""


def _validate_source(*, surface: str, source: DesiredAuthSource) -> None:
    if surface not in AGENT_AUTH_SURFACES:
        raise ValueError(f"Unknown agent auth surface: {surface}")
    if source.source_kind not in AGENT_AUTH_SOURCE_KINDS:
        raise ValueError(f"Unknown agent auth source kind: {source.source_kind}")
    if source.source_kind == AGENT_AUTH_SOURCE_API_KEY:
        # env_var_name is NOT required here: whether it must be present (bare
        # vault entry) or absent (typed entry) depends on the referenced
        # row's kind, which only _assert_keys_usable's query can see.
        if source.api_key_id is None:
            raise ValueError("An api_key source requires an api_key_id.")
    elif source.source_kind == AGENT_AUTH_SOURCE_SEAT:
        # api_key_id stays free (NULL = "use my seat pool"; non-null pins one
        # seat — that the pinned entry is an anthropic_subscription row is
        # _assert_keys_usable's cross-table check). The seat recipe owns its
        # env mapping, so a named env var is a shape error.
        if source.env_var_name is not None:
            raise ValueError("A seat source must not carry an env_var_name.")
    else:  # gateway
        if source.api_key_id is not None or source.env_var_name is not None:
            raise ValueError("A gateway source must not carry an api_key_id or env_var_name.")


async def _assert_keys_usable(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    sources: Sequence[DesiredAuthSource],
    supported_provider_config_kinds: Sequence[str],
) -> None:
    """The kind-aware write gate over every referenced vault entry.

    Four laws, in order:

    - every referenced id must be an active vault entry owned by the caller
      (``AgentApiKeyNotUsableError`` otherwise — a revoked, foreign, or
      vanished id is indistinguishable to the caller by design);
    - the selection's shape must match the referenced entry's kind
      (agent-auth.md "Shape checks are structural"): a bare ``api_key`` entry
      requires an ``env_var_name``, a typed entry (``aws_bedrock``,
      ``azure_openai``) must not carry one — the typed kind carries its own
      env mapping. Enforced here, not in SQL, because it spans tables;
    - a ``seat`` row that pins an entry must pin an ``anthropic_subscription``
      one — and, symmetrically, an ``api_key`` row may never reference a seat
      entry (the seat recipe, not an env var, is how a seat reaches a launch);
    - a typed entry's kind must be one of ``supported_provider_config_kinds``
      — the harness's registry-declared, non-pending providerConfig
      vocabulary, supplied by the caller (the store cannot read the registry
      itself: store→server import boundary). The default empty vocabulary
      fails closed (``AgentProviderConfigNotSupportedError``).
    """
    referencing_sources = [
        source
        for source in sources
        if source.source_kind in (AGENT_AUTH_SOURCE_API_KEY, AGENT_AUTH_SOURCE_SEAT)
        and source.api_key_id is not None
    ]
    api_key_ids = {source.api_key_id for source in referencing_sources if source.api_key_id}
    if not api_key_ids:
        return
    rows = (
        await db.execute(
            select(AgentApiKey.id, AgentApiKey.kind).where(
                AgentApiKey.id.in_(api_key_ids),
                AgentApiKey.user_id == user_id,
                AgentApiKey.status == AGENT_API_KEY_STATUS_ACTIVE,
            )
        )
    ).all()
    kind_by_id: dict[UUID, str] = {row.id: row.kind for row in rows}
    if set(kind_by_id) != api_key_ids:
        raise AgentApiKeyNotUsableError(
            "api_key_id must reference an active key owned by the user."
        )
    for source in referencing_sources:
        assert source.api_key_id is not None  # narrowed by the filter above
        kind = kind_by_id[source.api_key_id]
        if source.source_kind == AGENT_AUTH_SOURCE_SEAT:
            if kind != AGENT_API_KEY_KIND_ANTHROPIC_SUBSCRIPTION:
                raise ValueError(
                    "A seat selection must pin an anthropic_subscription vault "
                    f"entry, not a '{kind}' one."
                )
            continue
        if kind == AGENT_API_KEY_KIND_API_KEY:
            if source.env_var_name is None:
                raise ValueError(
                    "An api_key source referencing a bare key requires an env_var_name."
                )
            continue
        if kind == AGENT_API_KEY_KIND_ANTHROPIC_SUBSCRIPTION:
            raise ValueError(
                "An api_key source must not reference a seat "
                "(anthropic_subscription) vault entry — wire a seat row instead."
            )
        if kind not in AGENT_API_KEY_TYPED_KINDS:  # pragma: no cover - DB CHECK bound
            raise AgentApiKeyNotUsableError(f"Unknown vault entry kind: {kind}.")
        if source.env_var_name is not None:
            raise ValueError(
                "A selection referencing a typed vault entry must not name an "
                "env_var_name — the typed kind carries its own env mapping."
            )
        if kind not in supported_provider_config_kinds:
            raise AgentProviderConfigNotSupportedError(
                f"Harness '{harness_kind}' does not support provider-config "
                f"kind '{kind}' (not a declared, non-pending registry "
                "providerConfig kind)."
            )


async def put_auth_selections(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    surface: str,
    sources: Sequence[DesiredAuthSource],
    supported_provider_config_kinds: Sequence[str] = (),
) -> list[AgentAuthSelectionRecord]:
    """Replace a scope's selection rows with ``sources`` (full desired state).

    Existing rows keyed by (source_kind, env_var_name[, typed entry id]) are
    updated in place, absent ones deleted, and new ones inserted — so row ids
    and created_at survive across edits. The disabled gateway revision marker
    is normalized into every desired set. Structural coherence (source shape,
    key ownership, no duplicate source) is enforced; per-harness legality is
    the caller's — as is ``supported_provider_config_kinds``, the harness's
    registry-declared non-pending providerConfig vocabulary (the server layer
    reads it from the registry; the store cannot). The empty default admits
    no typed vault entry — closed unless the caller opens it.
    """
    if harness_kind not in AGENT_AUTH_HARNESS_KINDS:
        raise ValueError(f"Unknown agent harness kind: {harness_kind}")

    desired: dict[_SourceKey, DesiredAuthSource] = {}
    for source in sources:
        _validate_source(surface=surface, source=source)
        key = _source_key(source.source_kind, source.env_var_name, source.api_key_id)
        if key in desired:
            raise ValueError(
                "Duplicate selection source for "
                f"(source_kind={source.source_kind!r}, env_var_name={source.env_var_name!r})."
            )
        desired[key] = source

    # Keep a disabled gateway row even when an older/direct client sends the
    # native state as ``sources=[]``, regardless of whether this harness kind
    # is gateway-capable. Besides representing no effective source, this row
    # is the scope's durable revision marker: deleting the final row would
    # reset the rendered revision to zero (or an older sibling scope), causing
    # an AnyHarness runtime to reject the clear as stale and retain its prior
    # route. Surface-revision monotonicity is harness-agnostic — it must hold
    # even for a harness (e.g. cursor) that can never select the gateway
    # source itself.
    gateway_key = _source_key(AGENT_AUTH_SOURCE_GATEWAY, None, None)
    if gateway_key not in desired:
        desired[gateway_key] = DesiredAuthSource(
            source_kind=AGENT_AUTH_SOURCE_GATEWAY,
            enabled=False,
        )

    await _assert_keys_usable(
        db,
        user_id=user_id,
        harness_kind=harness_kind,
        sources=sources,
        supported_provider_config_kinds=supported_provider_config_kinds,
    )

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
    existing = {
        _source_key(row.source_kind, row.env_var_name, row.api_key_id): row
        for row in existing_rows
    }

    now = utcnow()
    selection_changed = False
    for key, row in existing.items():
        if key not in desired:
            await db.delete(row)
            selection_changed = True

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
            selection_changed = True
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
            selection_changed = True

    # A disabled gateway row is the scope's durable revision marker while the
    # effective route is native or API-key. Touch it for any desired-state
    # change, including deletion of a newer API-key row; otherwise max(updated_at)
    # can move backwards and the runtime correctly rejects the rendered state as
    # stale. The row remains disabled and never reaches materialization.
    gateway_marker = existing.get(gateway_key)
    if selection_changed and gateway_marker is not None:
        gateway_marker.updated_at = now

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


async def touch_auth_selection_revisions(
    db: AsyncSession,
    *,
    user_id: UUID,
    surface: str,
) -> int:
    """Bump ``updated_at`` on every selection row for one (user, surface).

    The rendered document's ``revision`` is ``max(updated_at)`` across the
    surface's rows (see ``materialize/agent_auth.py``), so touching the rows IS
    the surface's revision-bump seam — the same one ``put_auth_selections``
    exercises through its disabled-gateway marker row. It exists for
    out-of-band key events that change the rendered *content* without any
    selection edit (an enrollment reaching ``synced``): the next render then
    carries a strictly newer revision than any document pulled before the
    event, so a runtime holding the stale (keyless) document can never reject
    the re-render as out-of-order. Returns the number of rows touched; a
    surface with no rows renders no document, so zero is a correct no-op.
    """
    if surface not in AGENT_AUTH_SURFACES:
        raise ValueError(f"Unknown agent auth surface: {surface}")
    result = await db.execute(
        update(AgentAuthSelection)
        .where(
            AgentAuthSelection.user_id == user_id,
            AgentAuthSelection.surface == surface,
        )
        .values(updated_at=utcnow())
    )
    return result.rowcount or 0


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
