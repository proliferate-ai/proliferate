"""cloud repo config

Revision ID: f3c4d2a1b9e0
Revises: 72f3b6a08911
Create Date: 2026-04-09 13:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f3c4d2a1b9e0"
down_revision: str | Sequence[str] | None = "72f3b6a08911"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "cloud_repo_config",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("git_owner", sa.String(length=255), nullable=False),
        sa.Column("git_repo_name", sa.String(length=255), nullable=False),
        sa.Column("configured", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("configured_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("env_vars_ciphertext", sa.Text(), nullable=False, server_default=""),
        sa.Column("setup_script", sa.Text(), nullable=False, server_default=""),
        sa.Column("files_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "git_owner", "git_repo_name"),
    )
    op.create_index(
        "ix_cloud_repo_config_user_id",
        "cloud_repo_config",
        ["user_id"],
        unique=False,
    )

    op.create_table(
        "cloud_repo_file",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("cloud_repo_config_id", sa.Uuid(), nullable=False),
        sa.Column("relative_path", sa.String(length=1024), nullable=False),
        sa.Column("content_ciphertext", sa.Text(), nullable=False),
        sa.Column("content_sha256", sa.String(length=64), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["cloud_repo_config_id"],
            ["cloud_repo_config.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("cloud_repo_config_id", "relative_path"),
    )
    op.create_index(
        "ix_cloud_repo_file_cloud_repo_config_id",
        "cloud_repo_file",
        ["cloud_repo_config_id"],
        unique=False,
    )

    op.add_column(
        "cloud_workspace",
        sa.Column("repo_env_vars_ciphertext", sa.Text(), nullable=True),
    )
    op.add_column(
        "cloud_workspace",
        sa.Column("repo_files_applied_version", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "cloud_workspace",
        sa.Column(
            "repo_post_ready_phase",
            sa.String(length=32),
            nullable=False,
            server_default="idle",
        ),
    )
    op.add_column(
        "cloud_workspace",
        sa.Column("repo_post_ready_files_total", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "cloud_workspace",
        sa.Column(
            "repo_post_ready_files_applied",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "cloud_workspace",
        sa.Column("repo_files_last_failed_path", sa.String(length=1024), nullable=True),
    )
    op.add_column(
        "cloud_workspace",
        sa.Column("repo_files_last_error", sa.Text(), nullable=True),
    )
    op.add_column(
        "cloud_workspace",
        sa.Column("repo_files_applied_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "cloud_workspace",
        sa.Column("repo_post_ready_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "cloud_workspace",
        sa.Column("repo_post_ready_completed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("cloud_workspace", "repo_post_ready_completed_at")
    op.drop_column("cloud_workspace", "repo_post_ready_started_at")
    op.drop_column("cloud_workspace", "repo_files_applied_at")
    op.drop_column("cloud_workspace", "repo_files_last_error")
    op.drop_column("cloud_workspace", "repo_files_last_failed_path")
    op.drop_column("cloud_workspace", "repo_post_ready_files_applied")
    op.drop_column("cloud_workspace", "repo_post_ready_files_total")
    op.drop_column("cloud_workspace", "repo_post_ready_phase")
    op.drop_column("cloud_workspace", "repo_files_applied_version")
    op.drop_column("cloud_workspace", "repo_env_vars_ciphertext")

    op.drop_index("ix_cloud_repo_file_cloud_repo_config_id", table_name="cloud_repo_file")
    op.drop_table("cloud_repo_file")

    op.drop_index("ix_cloud_repo_config_user_id", table_name="cloud_repo_config")
    op.drop_table("cloud_repo_config")
