"""Agent auth route selection persistence.

Cross-column legality that SQL CHECKs cannot express cleanly (api_key
ownership + active status, slot semantics) is enforced here; callers get
typed ValueErrors.

Slot semantics (spec §3.3): single-source harnesses (claude/codex/grok/
gemini — and any harness that is not opencode) only ever use slot='primary',
so their selection keeps radio semantics. OpenCode is additive: one row per
slot in {'gateway','openai','anthropic','xai','google'} — the gateway slot
must carry the gateway route, provider slots must carry an api_key route
whose key belongs to that provider.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import Select, case, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from proliferate.constants.agent_gateway import (
    AGENT_API_KEY_STATUS_ACTIVE,
    AGENT_AUTH_HARNESS_KINDS,
    AGENT_AUTH_OPENCODE_HARNESS,
    AGENT_AUTH_OPENCODE_SLOTS,
    AGENT_AUTH_ROUTE_API_KEY,
    AGENT_AUTH_ROUTE_GATEWAY,
    AGENT_AUTH_ROUTE_NATIVE,
    AGENT_AUTH_ROUTES,
    AGENT_AUTH_SLOT_GATEWAY,
    AGENT_AUTH_SLOT_PRIMARY,
    AGENT_AUTH_SURFACE_CLOUD,
    AGENT_AUTH_SURFACE_LOCAL,
    AGENT_AUTH_SURFACES,
)
from proliferate.db.models.cloud.agent_gateway import AgentApiKey, AgentAuthRouteSelection
from proliferate.db.store.agent_gateway.mappers import route_selection_record
from proliferate.db.store.agent_gateway.records import AgentAuthRouteSelectionRecord
from proliferate.utils.time import utcnow


class AgentApiKeyNotUsableError(ValueError):
    """The referenced api key is not an active key owned by the caller."""


def validate_route_selection(
    *,
    surface: str,
    route: str,
    api_key_id: UUID | None,
    harness_kind: str | None = None,
    slot: str = AGENT_AUTH_SLOT_PRIMARY,
    target_id: UUID | None = None,
) -> None:
    """Pure legality checks shared by the store and unit tests.

    ``harness_kind`` is optional so surface/route legality can be exercised in
    isolation; when supplied, slot semantics are enforced first (unknown
    harnesses behave as single-source, spec §3.3) and the kind is then checked
    against the known allowlist so that unbounded path params cannot reach the
    ``String(64)`` column.
    """
    if harness_kind is not None:
        _validate_slot(harness_kind=harness_kind, route=route, slot=slot)
        if harness_kind not in AGENT_AUTH_HARNESS_KINDS:
            raise ValueError(f"Unknown agent harness kind: {harness_kind}")
    if surface not in AGENT_AUTH_SURFACES:
        raise ValueError(f"Unknown agent auth surface: {surface}")
    if route not in AGENT_AUTH_ROUTES:
        raise ValueError(f"Unknown agent auth route: {route}")
    if surface == AGENT_AUTH_SURFACE_CLOUD and route == AGENT_AUTH_ROUTE_NATIVE:
        raise ValueError("The native route is not available on the cloud surface.")
    if target_id is not None and surface != AGENT_AUTH_SURFACE_LOCAL:
        raise ValueError("target_id is only valid for local-surface selections.")
    if route == AGENT_AUTH_ROUTE_API_KEY and api_key_id is None:
        raise ValueError("An api_key route selection requires an api_key_id.")
    if route != AGENT_AUTH_ROUTE_API_KEY and api_key_id is not None:
        raise ValueError("api_key_id is only valid for api_key route selections.")


def _target_scope_filter(target_id: UUID | None) -> ColumnElement[bool]:
    if target_id is None:
        return AgentAuthRouteSelection.target_id.is_(None)
    return AgentAuthRouteSelection.target_id == target_id


def _validate_slot(*, harness_kind: str, route: str, slot: str) -> None:
    if harness_kind != AGENT_AUTH_OPENCODE_HARNESS:
        if slot != AGENT_AUTH_SLOT_PRIMARY:
            raise ValueError(
                f"Harness '{harness_kind}' is single-source and only supports "
                f"the '{AGENT_AUTH_SLOT_PRIMARY}' slot (got '{slot}')."
            )
        return
    if slot not in AGENT_AUTH_OPENCODE_SLOTS:
        raise ValueError(
            "OpenCode selections must target one of the slots: "
            f"{', '.join(AGENT_AUTH_OPENCODE_SLOTS)} (got '{slot}')."
        )
    if slot == AGENT_AUTH_SLOT_GATEWAY:
        if route != AGENT_AUTH_ROUTE_GATEWAY:
            raise ValueError(
                f"The opencode 'gateway' slot only carries the gateway route (got '{route}')."
            )
        return
    if route != AGENT_AUTH_ROUTE_API_KEY:
        raise ValueError(
            f"The opencode '{slot}' provider slot only carries the api_key route (got '{route}')."
        )


async def upsert_route_selection(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    surface: str,
    route: str,
    api_key_id: UUID | None = None,
    slot: str = AGENT_AUTH_SLOT_PRIMARY,
    target_id: UUID | None = None,
) -> AgentAuthRouteSelectionRecord:
    validate_route_selection(
        surface=surface,
        route=route,
        api_key_id=api_key_id,
        harness_kind=harness_kind,
        slot=slot,
        target_id=target_id,
    )
    if api_key_id is not None:
        key_row = (
            await db.execute(
                select(AgentApiKey).where(
                    AgentApiKey.id == api_key_id,
                    AgentApiKey.user_id == user_id,
                    AgentApiKey.status == AGENT_API_KEY_STATUS_ACTIVE,
                )
            )
        ).scalar_one_or_none()
        if key_row is None:
            raise AgentApiKeyNotUsableError(
                "api_key_id must reference an active key owned by the user."
            )
        if (
            harness_kind == AGENT_AUTH_OPENCODE_HARNESS
            and slot != AGENT_AUTH_SLOT_GATEWAY
            and key_row.provider != slot
        ):
            raise ValueError(
                f"The opencode '{slot}' slot requires a {slot} key (got a {key_row.provider} key)."
            )

    # Atomic upsert: two concurrent first writes for the same scope resolve via
    # ON CONFLICT instead of racing a select-then-insert into an IntegrityError.
    # The revision (and updated_at) only advance when route/api_key_id actually
    # change, preserving the prior idempotent semantics. Uniqueness is a pair
    # of partial indexes split on target_id nullity (NULLs are pairwise
    # distinct in one plain unique index), so the conflict target is the
    # matching index arbiter rather than a named constraint.
    now = utcnow()
    insert_stmt = pg_insert(AgentAuthRouteSelection).values(
        user_id=user_id,
        harness_kind=harness_kind,
        surface=surface,
        target_id=target_id,
        slot=slot,
        route=route,
        api_key_id=api_key_id,
        revision=1,
        created_at=now,
        updated_at=now,
    )
    changed = AgentAuthRouteSelection.route.is_distinct_from(
        insert_stmt.excluded.route
    ) | AgentAuthRouteSelection.api_key_id.is_distinct_from(insert_stmt.excluded.api_key_id)
    if target_id is None:
        index_elements = ["user_id", "harness_kind", "surface", "slot"]
        index_where = AgentAuthRouteSelection.target_id.is_(None)
    else:
        index_elements = ["user_id", "harness_kind", "surface", "target_id", "slot"]
        index_where = AgentAuthRouteSelection.target_id.is_not(None)
    await db.execute(
        insert_stmt.on_conflict_do_update(
            index_elements=index_elements,
            index_where=index_where,
            set_={
                "route": insert_stmt.excluded.route,
                "api_key_id": insert_stmt.excluded.api_key_id,
                "revision": case(
                    (changed, AgentAuthRouteSelection.revision + 1),
                    else_=AgentAuthRouteSelection.revision,
                ),
                "updated_at": case(
                    (changed, now),
                    else_=AgentAuthRouteSelection.updated_at,
                ),
            },
        )
    )
    await db.flush()
    row = (
        await db.execute(
            select(AgentAuthRouteSelection)
            .where(
                AgentAuthRouteSelection.user_id == user_id,
                AgentAuthRouteSelection.harness_kind == harness_kind,
                AgentAuthRouteSelection.surface == surface,
                _target_scope_filter(target_id),
                AgentAuthRouteSelection.slot == slot,
            )
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    return route_selection_record(row)


async def get_route_selection(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    surface: str,
    slot: str = AGENT_AUTH_SLOT_PRIMARY,
    target_id: UUID | None = None,
) -> AgentAuthRouteSelectionRecord | None:
    row = (
        await db.execute(
            select(AgentAuthRouteSelection).where(
                AgentAuthRouteSelection.user_id == user_id,
                AgentAuthRouteSelection.harness_kind == harness_kind,
                AgentAuthRouteSelection.surface == surface,
                _target_scope_filter(target_id),
                AgentAuthRouteSelection.slot == slot,
            )
        )
    ).scalar_one_or_none()
    return route_selection_record(row) if row is not None else None


async def delete_route_selection(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    surface: str,
    slot: str = AGENT_AUTH_SLOT_PRIMARY,
    target_id: UUID | None = None,
) -> bool:
    """Clear the selection for a scope. Returns whether a row was deleted."""
    row = (
        await db.execute(
            select(AgentAuthRouteSelection).where(
                AgentAuthRouteSelection.user_id == user_id,
                AgentAuthRouteSelection.harness_kind == harness_kind,
                AgentAuthRouteSelection.surface == surface,
                _target_scope_filter(target_id),
                AgentAuthRouteSelection.slot == slot,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return False
    deleted_revision = row.revision
    await db.delete(row)
    await db.flush()
    await _preserve_scope_revision_after_delete(
        db,
        user_id=user_id,
        harness_kind=harness_kind,
        surface=surface,
        slot=slot,
        target_id=target_id,
        deleted_revision=deleted_revision,
    )
    return True


async def _preserve_scope_revision_after_delete(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    surface: str,
    slot: str,
    target_id: UUID | None,
    deleted_revision: int,
) -> None:
    """Keep a delete from lowering the affected document's rendered revision.

    The document revision is ``max(revision)`` over the scope's basis rows
    (``resolve_surface_selections``), and the runtime rejects pushes whose
    revision is below the persisted one (stale-write guard). If the deleted
    row carried the strict max, the reverted document would be permanently
    unpushable — the runtime would keep rendering the deleted selection's
    credentials. So the row that now carries the revert — the shadowed default
    for an override delete, else the highest-revision surviving basis row — is
    bumped past the deleted revision, making the revert strictly supersede the
    last pushed document. With no surviving basis rows the document disappears
    entirely (revision-0 marker), and there is nothing to carry.
    """
    scope: ColumnElement[bool] = AgentAuthRouteSelection.target_id.is_(None)
    if target_id is not None:
        scope = or_(scope, AgentAuthRouteSelection.target_id == target_id)
    survivors = (
        (
            await db.execute(
                select(AgentAuthRouteSelection).where(
                    AgentAuthRouteSelection.user_id == user_id,
                    AgentAuthRouteSelection.surface == surface,
                    scope,
                )
            )
        )
        .scalars()
        .all()
    )
    if not survivors or max(row.revision for row in survivors) >= deleted_revision:
        return
    shadowed_default = next(
        (
            row
            for row in survivors
            if target_id is not None
            and row.target_id is None
            and row.harness_kind == harness_kind
            and row.slot == slot
        ),
        None,
    )
    carrier = shadowed_default or max(
        survivors,
        key=lambda row: (row.revision, row.harness_kind, row.slot),
    )
    carrier.revision = deleted_revision + 1
    carrier.updated_at = utcnow()
    await db.flush()


def _selection_list_order(
    stmt: Select[tuple[AgentAuthRouteSelection]],
) -> Select[tuple[AgentAuthRouteSelection]]:
    return stmt.order_by(
        AgentAuthRouteSelection.harness_kind,
        AgentAuthRouteSelection.surface,
        AgentAuthRouteSelection.slot,
    )


async def list_route_selections(
    db: AsyncSession,
    *,
    user_id: UUID,
    target_id: UUID | None = None,
) -> list[AgentAuthRouteSelectionRecord]:
    """List one scope's selections: the default rows, or one target's rows.

    ``target_id`` None returns only default rows (``target_id`` IS NULL) —
    never any target's overrides — so callers keep exactly one row per
    (harness_kind, surface, slot). A target id returns only that target's
    override rows. Renderers that need both layers use
    :func:`list_all_route_selections`.
    """
    stmt = select(AgentAuthRouteSelection).where(
        AgentAuthRouteSelection.user_id == user_id,
        _target_scope_filter(target_id),
    )
    rows = (await db.execute(_selection_list_order(stmt))).scalars().all()
    return [route_selection_record(row) for row in rows]


async def list_all_route_selections(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> list[AgentAuthRouteSelectionRecord]:
    """List every selection row — default rows plus every target's overrides.

    Feed for the inheritance render (``resolve_surface_selections``), which
    needs both layers to merge a target document.
    """
    stmt = select(AgentAuthRouteSelection).where(AgentAuthRouteSelection.user_id == user_id)
    rows = (await db.execute(_selection_list_order(stmt))).scalars().all()
    return [route_selection_record(row) for row in rows]
