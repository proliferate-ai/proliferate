"""Re-home stranded free-included grants onto the paying org subject (W-F1).

Law W1 ("the org always pays") governs money IN as well as money out. Before
this, ``free_included`` grants were always minted on the buyer's PERSONAL
billing subject while compute spend drained the ORG subject resolved from the
user's current membership. The result was a balance a user could see and never
spend: 5 free hours parked on personal, an empty org pool, and — under
``CLOUD_BILLING_MODE=enforce`` — a blocked first start.

This moves each such grant to the subject that actually pays, preserving
``remaining_seconds`` exactly. It is a change of pool, not a new allowance:
re-homing must never re-grant hours a user already spent, nor strand hours they
have not. ``billing_grant.source_ref`` is globally unique
(``free_included:{user_id}``), so there is at most one row per user to move and
running this twice is a no-op.

"Current membership" is resolved the same way the runtime does
(``resolve_billing_subject_id_for_user`` → ``get_current_membership_for_user``):
the user's active membership in a current-status organization, ordered by
organization name, first row wins. Users with no active membership are left on
personal, which is correct — that is the subject their compute drains.

A user whose org has no ``billing_subject`` row yet is skipped here, not
mishandled: the runtime creates that subject on the next payer resolution
(``ensure_organization_billing_subject``) and re-homes the grant in the same
call, so the fix does not depend on this backfill having seen every user.

Only grants of type ``free_included`` on a personal subject move. Purchased
``refill_10h`` grants are deliberately untouched: none exist in production (live
Stripe has zero completed refill purchases as of 2026-07-29), and money already
taken is not something a schema migration should silently re-attribute.

Revision ID: b5d7f9a1c3e5
Revises: a4c6e8b0d2f4
Create Date: 2026-07-29 03:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b5d7f9a1c3e5"
down_revision: str | Sequence[str] | None = "a4c6e8b0d2f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_REQUIRED_TABLES = (
    "billing_grant",
    "billing_subject",
    "organization",
    "organization_membership",
)

# The payer for each user that has one: their current membership's organization
# billing subject. DISTINCT ON + the name ordering mirrors
# ``_list_organizations_for_user`` (ORDER BY organization.name ASC, first row).
_PAYER_SUBJECT_SQL = """
    SELECT DISTINCT ON (m.user_id)
        m.user_id AS user_id,
        s.id AS payer_subject_id
    FROM organization_membership AS m
    JOIN organization AS o ON o.id = m.organization_id
    JOIN billing_subject AS s ON s.organization_id = o.id
    WHERE m.status = 'active'
      AND o.status IN ('active', 'suspended')
      AND s.kind = 'organization'
    ORDER BY m.user_id, o.name ASC, o.id ASC
"""


def _tables_present() -> bool:
    names = set(sa.inspect(op.get_bind()).get_table_names())
    return all(table in names for table in _REQUIRED_TABLES)


def upgrade() -> None:
    if not _tables_present():
        return
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            f"""
            WITH payer AS ({_PAYER_SUBJECT_SQL})
            UPDATE billing_grant AS g
            SET billing_subject_id = payer.payer_subject_id,
                updated_at = now()
            FROM payer, billing_subject AS current_subject
            WHERE g.user_id = payer.user_id
              AND g.grant_type = 'free_included'
              AND current_subject.id = g.billing_subject_id
              AND current_subject.kind = 'personal'
              AND g.billing_subject_id <> payer.payer_subject_id
            """
        )
    )
    print(f"W-F1 backfill: re-homed {result.rowcount} free_included grant(s) onto org subjects.")


def downgrade() -> None:
    """Send each re-homed grant back to its owner's personal billing subject.

    Only grants whose ``user_id`` has a personal subject move back, and only
    from an organization subject. ``remaining_seconds`` is preserved, so a
    down-then-up round trip conserves every hour.
    """
    if not _tables_present():
        return
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE billing_grant AS g
            SET billing_subject_id = personal.id,
                updated_at = now()
            FROM billing_subject AS personal, billing_subject AS current_subject
            WHERE personal.kind = 'personal'
              AND personal.user_id = g.user_id
              AND current_subject.id = g.billing_subject_id
              AND current_subject.kind = 'organization'
              AND g.grant_type = 'free_included'
            """
        )
    )
