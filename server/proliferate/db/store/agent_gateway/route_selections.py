"""Agent auth route selection persistence.

Cross-column legality that SQL CHECKs cannot express cleanly (api_key
ownership + active status) is enforced here; callers get typed ValueErrors.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import case, delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.agent_gateway import (
    AGENT_API_KEY_STATUS_ACTIVE,
    AGENT_AUTH_HARNESS_KINDS,
    AGENT_AUTH_ROUTE_API_KEY,
    AGENT_AUTH_ROUTE_NATIVE,
    AGENT_AUTH_ROUTES,
    AGENT_AUTH_SURFACE_CLOUD,
    AGENT_AUTH_SURFACES,
)
from proliferate.db.models.cloud.agent_gateway import AgentApiKey, AgentAuthRouteSelection
from proliferate.db.store.agent_gateway.mappers import route_selection_record
from proliferate.db.store.agent_gateway.records import AgentAuthRouteSelectionRecord
from proliferate.utils.time import utcnow


def validate_route_selection(
    *,
    surface: str,
    route: str,
    api_key_id: UUID | None,
    harness_kind: str | None = None,
) -> None:
    """Pure legality checks shared by the store and unit tests.

    ``harness_kind`` is optional so surface/route legality can be exercised in
    isolation; when supplied it is checked against the known allowlist so that
    unbounded path params cannot reach the ``String(64)`` column.
    """
    if harness_kind is not None and harness_kind not in AGENT_AUTH_HARNESS_KINDS:
        raise ValueError(f"Unknown agent harness kind: {harness_kind}")
    if surface not in AGENT_AUTH_SURFACES:
        raise ValueError(f"Unknown agent auth surface: {surface}")
    if route not in AGENT_AUTH_ROUTES:
        raise ValueError(f"Unknown agent auth route: {route}")
    if surface == AGENT_AUTH_SURFACE_CLOUD and route == AGENT_AUTH_ROUTE_NATIVE:
        raise ValueError("The native route is not available on the cloud surface.")
    if route == AGENT_AUTH_ROUTE_API_KEY and api_key_id is None:
        raise ValueError("An api_key route selection requires an api_key_id.")
    if route != AGENT_AUTH_ROUTE_API_KEY and api_key_id is not None:
        raise ValueError("api_key_id is only valid for api_key route selections.")


async def upsert_route_selection(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    surface: str,
    route: str,
    api_key_id: UUID | None = None,
) -> AgentAuthRouteSelectionRecord:
    validate_route_selection(
        surface=surface,
        route=route,
        api_key_id=api_key_id,
        harness_kind=harness_kind,
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
            raise ValueError("api_key_id must reference an active key owned by the user.")

    # Atomic upsert: two concurrent first writes for the same scope resolve via
    # ON CONFLICT instead of racing a select-then-insert into an IntegrityError.
    # The revision (and updated_at) only advance when route/api_key_id actually
    # change, preserving the prior idempotent semantics.
    now = utcnow()
    insert_stmt = pg_insert(AgentAuthRouteSelection).values(
        user_id=user_id,
        harness_kind=harness_kind,
        surface=surface,
        route=route,
        api_key_id=api_key_id,
        revision=1,
        created_at=now,
        updated_at=now,
    )
    changed = AgentAuthRouteSelection.route.is_distinct_from(
        insert_stmt.excluded.route
    ) | AgentAuthRouteSelection.api_key_id.is_distinct_from(insert_stmt.excluded.api_key_id)
    await db.execute(
        insert_stmt.on_conflict_do_update(
            constraint="uq_agent_auth_route_selection_scope",
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
) -> AgentAuthRouteSelectionRecord | None:
    row = (
        await db.execute(
            select(AgentAuthRouteSelection).where(
                AgentAuthRouteSelection.user_id == user_id,
                AgentAuthRouteSelection.harness_kind == harness_kind,
                AgentAuthRouteSelection.surface == surface,
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
) -> bool:
    """Clear the selection for a scope. Returns whether a row was deleted."""
    result = await db.execute(
        delete(AgentAuthRouteSelection).where(
            AgentAuthRouteSelection.user_id == user_id,
            AgentAuthRouteSelection.harness_kind == harness_kind,
            AgentAuthRouteSelection.surface == surface,
        )
    )
    return (result.rowcount or 0) > 0


async def list_route_selections(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> list[AgentAuthRouteSelectionRecord]:
    rows = (
        (
            await db.execute(
                select(AgentAuthRouteSelection)
                .where(AgentAuthRouteSelection.user_id == user_id)
                .order_by(
                    AgentAuthRouteSelection.harness_kind,
                    AgentAuthRouteSelection.surface,
                )
            )
        )
        .scalars()
        .all()
    )
    return [route_selection_record(row) for row in rows]
