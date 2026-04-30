"""cloud workspace setup runs

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-04-28 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e2f3a4b5c6d7"
down_revision: str | Sequence[str] | None = "d1e2f3a4b5c6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_column("cloud_workspace", "repo_post_ready_apply_token"):
        op.add_column(
            "cloud_workspace",
            sa.Column("repo_post_ready_apply_token", sa.String(length=64), nullable=True),
        )

    if not _has_table("cloud_workspace_setup_run"):
        op.create_table(
            "cloud_workspace_setup_run",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("workspace_id", sa.Uuid(), nullable=False),
            sa.Column("anyharness_workspace_id", sa.String(length=255), nullable=False),
            sa.Column("terminal_id", sa.String(length=255), nullable=True),
            sa.Column("command_run_id", sa.String(length=255), nullable=False),
            sa.Column("setup_script_version", sa.Integer(), nullable=False),
            sa.Column("apply_token", sa.String(length=64), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
            sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("claim_owner", sa.String(length=255), nullable=True),
            sa.Column("claim_until", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_polled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("next_poll_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["workspace_id"],
                ["cloud_workspace.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "command_run_id",
                name="uq_cloud_workspace_setup_run_command_run_id",
            ),
        )
        op.create_index(
            "ix_cloud_workspace_setup_run_workspace_id",
            "cloud_workspace_setup_run",
            ["workspace_id"],
            unique=False,
        )
        op.create_index(
            "ix_cloud_workspace_setup_run_reconciler",
            "cloud_workspace_setup_run",
            ["status", "deadline_at", "claim_until", "next_poll_at"],
            unique=False,
        )
        op.create_index(
            "ix_cloud_workspace_setup_run_workspace_token",
            "cloud_workspace_setup_run",
            ["workspace_id", "apply_token", "setup_script_version"],
            unique=False,
        )


def downgrade() -> None:
    """Downgrade schema."""
    if _has_table("cloud_workspace_setup_run"):
        op.drop_table("cloud_workspace_setup_run")
    if _has_column("cloud_workspace", "repo_post_ready_apply_token"):
        op.drop_column("cloud_workspace", "repo_post_ready_apply_token")
