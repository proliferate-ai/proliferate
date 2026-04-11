"""restore cloud workspace mobility

Revision ID: b6c7d8e9f0a1
Revises: a5b6c7d8e9f0
Create Date: 2026-04-12 11:20:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b6c7d8e9f0a1"
down_revision: str | Sequence[str] | None = "a5b6c7d8e9f0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in set(inspector.get_table_names())


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_table("cloud_workspace_mobility"):
        op.create_table(
            "cloud_workspace_mobility",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("display_name", sa.String(length=255), nullable=True),
            sa.Column("git_provider", sa.String(length=32), nullable=False),
            sa.Column("git_owner", sa.String(length=255), nullable=False),
            sa.Column("git_repo_name", sa.String(length=255), nullable=False),
            sa.Column("git_branch", sa.String(length=255), nullable=False),
            sa.Column("owner", sa.String(length=32), nullable=False),
            sa.Column("lifecycle_state", sa.String(length=32), nullable=False),
            sa.Column("status_detail", sa.String(length=255), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("cloud_workspace_id", sa.Uuid(), nullable=True),
            sa.Column("active_handoff_op_id", sa.Uuid(), nullable=True),
            sa.Column("last_handoff_op_id", sa.Uuid(), nullable=True),
            sa.Column("cloud_lost_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("cloud_lost_reason", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["cloud_workspace_id"],
                ["cloud_workspace.id"],
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "user_id",
                "git_provider",
                "git_owner",
                "git_repo_name",
                "git_branch",
            ),
        )
    if not _has_index(
        "cloud_workspace_mobility",
        "ix_cloud_workspace_mobility_user_id",
    ):
        op.create_index(
            "ix_cloud_workspace_mobility_user_id",
            "cloud_workspace_mobility",
            ["user_id"],
            unique=False,
        )
    if not _has_index(
        "cloud_workspace_mobility",
        "ix_cloud_workspace_mobility_cloud_workspace_id",
    ):
        op.create_index(
            "ix_cloud_workspace_mobility_cloud_workspace_id",
            "cloud_workspace_mobility",
            ["cloud_workspace_id"],
            unique=False,
        )

    if _has_table("cloud_workspace_handoff_op"):
        return

    op.create_table(
        "cloud_workspace_handoff_op",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("mobility_workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("direction", sa.String(length=32), nullable=False),
        sa.Column("source_owner", sa.String(length=32), nullable=False),
        sa.Column("target_owner", sa.String(length=32), nullable=False),
        sa.Column("phase", sa.String(length=32), nullable=False),
        sa.Column("requested_branch", sa.String(length=255), nullable=False),
        sa.Column("requested_base_sha", sa.String(length=255), nullable=True),
        sa.Column("exclude_paths_json", sa.Text(), nullable=False),
        sa.Column("failure_code", sa.String(length=64), nullable=True),
        sa.Column("failure_detail", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cleanup_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["mobility_workspace_id"],
            ["cloud_workspace_mobility.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_cloud_workspace_handoff_op_mobility_workspace_id",
        "cloud_workspace_handoff_op",
        ["mobility_workspace_id"],
        unique=False,
    )
    op.create_index(
        "ix_cloud_workspace_handoff_op_user_id",
        "cloud_workspace_handoff_op",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    if _has_table("cloud_workspace_handoff_op"):
        if _has_index(
            "cloud_workspace_handoff_op",
            "ix_cloud_workspace_handoff_op_user_id",
        ):
            op.drop_index(
                "ix_cloud_workspace_handoff_op_user_id",
                table_name="cloud_workspace_handoff_op",
            )
        if _has_index(
            "cloud_workspace_handoff_op",
            "ix_cloud_workspace_handoff_op_mobility_workspace_id",
        ):
            op.drop_index(
                "ix_cloud_workspace_handoff_op_mobility_workspace_id",
                table_name="cloud_workspace_handoff_op",
            )
        op.drop_table("cloud_workspace_handoff_op")

    if not _has_table("cloud_workspace_mobility"):
        return

    if _has_index(
        "cloud_workspace_mobility",
        "ix_cloud_workspace_mobility_cloud_workspace_id",
    ):
        op.drop_index(
            "ix_cloud_workspace_mobility_cloud_workspace_id",
            table_name="cloud_workspace_mobility",
        )
    if _has_index(
        "cloud_workspace_mobility",
        "ix_cloud_workspace_mobility_user_id",
    ):
        op.drop_index(
            "ix_cloud_workspace_mobility_user_id",
            table_name="cloud_workspace_mobility",
        )
    op.drop_table("cloud_workspace_mobility")
