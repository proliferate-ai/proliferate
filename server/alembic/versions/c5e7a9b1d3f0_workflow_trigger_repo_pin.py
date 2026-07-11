"""workflow_trigger repo pin + input presets (D16)

Revision ID: c5e7a9b1d3f0
Revises: a7b9c1d3e5f7
Create Date: 2026-07-09 01:00:00.000000

PR G (D16): the trigger — not the definition — knows *where* an unattended run
works. ``repo_full_name`` ("org/repo") becomes the authored concept for
schedule/poll triggers (CHECK-required for those kinds); ``target_workspace_id``
stays but is now DERIVED — the server ensures a dedicated cloud workspace for the
pinned repo and stamps its id. ``input_presets_json`` records the schedule preset
input values that back the enable-gate (a schedule trigger cannot be enabled until
every required workflow input has a preset). Idempotent-guarded like the stack.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c5e7a9b1d3f0"
down_revision: str | Sequence[str] | None = "a7b9c1d3e5f7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {col["name"] for col in inspector.get_columns(table_name)}


def _has_check(table_name: str, constraint_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return constraint_name in {
        constraint["name"] for constraint in inspector.get_check_constraints(table_name)
    }


def upgrade() -> None:
    if not _has_column("workflow_trigger", "repo_full_name"):
        op.add_column(
            "workflow_trigger",
            sa.Column("repo_full_name", sa.String(length=255), nullable=True),
        )
    if not _has_column("workflow_trigger", "input_presets_json"):
        op.add_column(
            "workflow_trigger",
            sa.Column("input_presets_json", JSONB(), nullable=True),
        )
    # A schedule/poll trigger must pin a repo — it is the authored source of the
    # derived warm workspace. (target_workspace_id stays derived, so its own CHECK
    # is unchanged.)
    if not _has_check("workflow_trigger", "ck_workflow_trigger_repo_full_name"):
        op.create_check_constraint(
            "ck_workflow_trigger_repo_full_name",
            "workflow_trigger",
            "kind NOT IN ('schedule', 'poll') OR repo_full_name IS NOT NULL",
        )


def downgrade() -> None:
    if _has_check("workflow_trigger", "ck_workflow_trigger_repo_full_name"):
        op.drop_constraint(
            "ck_workflow_trigger_repo_full_name", "workflow_trigger", type_="check"
        )
    if _has_column("workflow_trigger", "input_presets_json"):
        op.drop_column("workflow_trigger", "input_presets_json")
    if _has_column("workflow_trigger", "repo_full_name"):
        op.drop_column("workflow_trigger", "repo_full_name")
