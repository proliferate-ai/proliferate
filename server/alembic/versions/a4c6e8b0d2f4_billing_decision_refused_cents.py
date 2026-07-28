"""record how much over-cap spend a decision receipt refused

Revision ID: a4c6e8b0d2f4
Revises: 7f3a9b2c4d5e
Create Date: 2026-07-28 00:00:00.000000

Law A2 ("no orphaned spend — every closed segment is grant-covered, exported, or
receipted") is only satisfied if the receipt is *attributable*. The
``overage_cap_reached`` receipt said that a slice was refused but not how much:
the amount lived only in the accounting pass's in-memory
``BillingAccountingResult.over_cap_cents``, and by the time the receipt was
written the usage cursor had already advanced, so no durable row could
reconstruct it (the refused remainder deliberately produces no export row —
write-off is operator-only, ruled 2026-07-14).

``refused_cents`` is nullable because it is meaningful only for the cap-refusal
receipt; every other ``billing_decision_event`` reason (start gates, export
delivery outcomes, reconciler holds) refuses no metered spend and leaves it NULL.
Existing rows stay NULL: the amount they refused is genuinely unknown and
backfilling a zero would assert otherwise.

It records the first refusal's amount for the standing over-cap condition, not
a running total: the receipt itself is deduped across passes (one receipt per
refusal run, not per pass), so later passes in the same run never write a
second row to accumulate into.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a4c6e8b0d2f4"
down_revision: str | Sequence[str] | None = "7f3a9b2c4d5e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "billing_decision_event",
        sa.Column("refused_cents", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("billing_decision_event", "refused_cents")
