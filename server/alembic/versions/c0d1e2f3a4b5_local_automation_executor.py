"""local automation executor support

Revision ID: c0d1e2f3a4b5
Revises: b9c0d1e2f3a4
Create Date: 2026-04-21 16:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c0d1e2f3a4b5"
down_revision: str | Sequence[str] | None = "b9c0d1e2f3a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    if not _has_table("automation_run"):
        return

    if not _has_index("automation_run", "ix_automation_run_local_claimable"):
        op.create_index(
            "ix_automation_run_local_claimable",
            "automation_run",
            [
                "user_id",
                "git_provider_snapshot",
                "git_owner_snapshot",
                "git_repo_name_snapshot",
                "created_at",
            ],
            unique=False,
            postgresql_where=sa.text(
                "execution_target = 'local' "
                "AND status IN ("
                "'queued', "
                "'claimed', "
                "'creating_workspace', "
                "'provisioning_workspace', "
                "'creating_session'"
                ")"
            ),
        )
    if not _has_index("automation_run", "ix_automation_run_local_claim_expiry"):
        op.create_index(
            "ix_automation_run_local_claim_expiry",
            "automation_run",
            ["claim_expires_at"],
            unique=False,
            postgresql_where=sa.text(
                "execution_target = 'local' "
                "AND status IN ("
                "'claimed', "
                "'creating_workspace', "
                "'provisioning_workspace', "
                "'creating_session', "
                "'dispatching'"
                ") "
                "AND claim_expires_at IS NOT NULL"
            ),
        )
    if not _has_index("automation_run", "ix_automation_run_dispatching_expiry"):
        op.create_index(
            "ix_automation_run_dispatching_expiry",
            "automation_run",
            ["claim_expires_at"],
            unique=False,
            postgresql_where=sa.text(
                "status = 'dispatching' AND claim_expires_at IS NOT NULL"
            ),
        )

    if _has_table("automation"):
        op.execute(
            sa.text(
                "UPDATE automation "
                "SET enabled = false, paused_at = now(), next_run_at = NULL, updated_at = now() "
                "WHERE execution_target = 'local' AND enabled = true AND agent_kind IS NULL"
            )
        )


def downgrade() -> None:
    if not _has_table("automation_run"):
        return
    if _has_index("automation_run", "ix_automation_run_dispatching_expiry"):
        op.drop_index("ix_automation_run_dispatching_expiry", table_name="automation_run")
    if _has_index("automation_run", "ix_automation_run_local_claim_expiry"):
        op.drop_index("ix_automation_run_local_claim_expiry", table_name="automation_run")
    if _has_index("automation_run", "ix_automation_run_local_claimable"):
        op.drop_index("ix_automation_run_local_claimable", table_name="automation_run")
