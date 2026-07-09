"""backfill "native" into legacy org_agent_policy allowed_routes

Before this branch, "native" was not a valid policy route value: an admin could
never persist it in ``allowed_routes_json`` (the server 400'd on it). Enforcement
now reads a non-null ``allowed_routes`` list as authoritative — a route absent
from the list is DISALLOWED, and that now includes "native".

To avoid retroactively locking orgs out of native CLI login (which no admin
could have intentionally disallowed), we normalize every pre-existing non-null
``allowed_routes_json`` to explicitly include "native". After this backfill,
absence of "native" unambiguously means an admin intentionally disallowed it via
the fixed pane. Rows with a null list (no restriction) are left untouched.

Revision ID: 76c0a297415c
Revises: d4bbfa6e0669
Create Date: 2026-07-07 00:00:00.000000

"""

from __future__ import annotations

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "76c0a297415c"
down_revision: Union[str, Sequence[str], None] = "d4bbfa6e0669"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NATIVE = "native"


def backfill_native(raw: str | None) -> str | None:
    """Return ``raw`` with "native" appended if it is a list missing it.

    Pure JSON→JSON transform (no DB), extracted so the migration's data rule can
    be unit-tested. Returns ``None`` (no update) when the value is null, not a
    JSON list, or already contains "native".
    """
    if raw is None:
        return None
    try:
        routes = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(routes, list) or _NATIVE in routes:
        return None
    return json.dumps([*routes, _NATIVE])


def upgrade() -> None:
    """Add "native" to every non-null allowed_routes list that lacks it."""
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT organization_id, allowed_routes_json "
            "FROM org_agent_policy "
            "WHERE allowed_routes_json IS NOT NULL"
        )
    ).fetchall()
    for organization_id, raw in rows:
        updated = backfill_native(raw)
        if updated is None:
            continue
        bind.execute(
            sa.text(
                "UPDATE org_agent_policy "
                "SET allowed_routes_json = :routes "
                "WHERE organization_id = :org_id"
            ),
            {"routes": updated, "org_id": organization_id},
        )


def downgrade() -> None:
    """Remove the backfilled "native" from non-null allowed_routes lists.

    Best-effort inverse: strips "native" from restricted lists. It cannot know
    which rows had "native" added by this migration versus set intentionally
    afterward, so downgrading may drop a deliberate "native" allow — acceptable
    for a forward-only pipeline.
    """
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT organization_id, allowed_routes_json "
            "FROM org_agent_policy "
            "WHERE allowed_routes_json IS NOT NULL"
        )
    ).fetchall()
    for organization_id, raw in rows:
        try:
            routes = json.loads(raw)
        except (TypeError, ValueError):
            continue
        if not isinstance(routes, list) or _NATIVE not in routes:
            continue
        remaining = [route for route in routes if route != _NATIVE]
        bind.execute(
            sa.text(
                "UPDATE org_agent_policy "
                "SET allowed_routes_json = :routes "
                "WHERE organization_id = :org_id"
            ),
            {"routes": json.dumps(remaining), "org_id": organization_id},
        )
