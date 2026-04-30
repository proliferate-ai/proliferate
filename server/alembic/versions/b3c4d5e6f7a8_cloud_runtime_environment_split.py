"""cloud runtime environment split

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7, c1d2e3f4a5b6
Create Date: 2026-04-20 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3c4d5e6f7a8"
down_revision: str | Sequence[str] | None = ("a2b3c4d5e6f7", "c1d2e3f4a5b6")
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


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_table("cloud_runtime_environment"):
        op.create_table(
            "cloud_runtime_environment",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("organization_id", sa.Uuid(), nullable=True),
            sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
            sa.Column("billing_subject_id", sa.Uuid(), nullable=False),
            sa.Column("git_provider", sa.String(length=32), nullable=False),
            sa.Column("git_owner", sa.String(length=255), nullable=False),
            sa.Column("git_repo_name", sa.String(length=255), nullable=False),
            sa.Column("git_owner_norm", sa.String(length=255), nullable=False),
            sa.Column("git_repo_name_norm", sa.String(length=255), nullable=False),
            sa.Column(
                "isolation_policy",
                sa.String(length=32),
                nullable=False,
                server_default="repo_shared",
            ),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
            sa.Column("active_sandbox_id", sa.Uuid(), nullable=True),
            sa.Column("runtime_url", sa.Text(), nullable=True),
            sa.Column("runtime_token_ciphertext", sa.Text(), nullable=True),
            sa.Column("anyharness_data_key_ciphertext", sa.Text(), nullable=True),
            sa.Column("root_anyharness_workspace_id", sa.String(length=255), nullable=True),
            sa.Column("root_anyharness_repo_root_id", sa.String(length=255), nullable=True),
            sa.Column("runtime_generation", sa.Integer(), nullable=False, server_default="0"),
            sa.Column(
                "credential_snapshot_version", sa.Integer(), nullable=False, server_default="0"
            ),
            sa.Column(
                "repo_env_applied_version", sa.Integer(), nullable=False, server_default="0"
            ),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "organization_id IS NULL",
                name="ck_cloud_runtime_environment_v1_org_id_null",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
    for index_name, columns in (
        ("ix_cloud_runtime_environment_user_id", ["user_id"]),
        ("ix_cloud_runtime_environment_organization_id", ["organization_id"]),
        ("ix_cloud_runtime_environment_created_by_user_id", ["created_by_user_id"]),
        ("ix_cloud_runtime_environment_billing_subject_id", ["billing_subject_id"]),
    ):
        if not _has_index("cloud_runtime_environment", index_name):
            op.create_index(index_name, "cloud_runtime_environment", columns, unique=False)
    if not _has_index(
        "cloud_runtime_environment",
        "uq_cloud_runtime_environment_user_repo_policy",
    ):
        op.create_index(
            "uq_cloud_runtime_environment_user_repo_policy",
            "cloud_runtime_environment",
            [
                "user_id",
                "git_provider",
                "git_owner_norm",
                "git_repo_name_norm",
                "isolation_policy",
            ],
            unique=True,
            postgresql_where=sa.text("organization_id IS NULL"),
        )

    cloud_workspace_columns: list[sa.Column] = [
        sa.Column("runtime_environment_id", sa.Uuid(), nullable=True),
        sa.Column("repo_setup_applied_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("archive_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cleanup_state", sa.String(length=32), nullable=False, server_default="none"),
        sa.Column("cleanup_last_error", sa.Text(), nullable=True),
    ]
    for column in cloud_workspace_columns:
        if not _has_column("cloud_workspace", column.name):
            op.add_column("cloud_workspace", column)
    if not _has_index("cloud_workspace", "ix_cloud_workspace_runtime_environment_id"):
        op.create_index(
            "ix_cloud_workspace_runtime_environment_id",
            "cloud_workspace",
            ["runtime_environment_id"],
            unique=False,
        )
    if not _has_index("cloud_workspace", "uq_cloud_workspace_active_branch"):
        op.create_index(
            "uq_cloud_workspace_active_branch",
            "cloud_workspace",
            ["runtime_environment_id", "git_branch"],
            unique=True,
            postgresql_where=sa.text("archived_at IS NULL"),
        )

    if not _has_column("cloud_sandbox", "runtime_environment_id"):
        op.add_column(
            "cloud_sandbox", sa.Column("runtime_environment_id", sa.Uuid(), nullable=True)
        )
    if not _has_index("cloud_sandbox", "ix_cloud_sandbox_runtime_environment_id"):
        op.create_index(
            "ix_cloud_sandbox_runtime_environment_id",
            "cloud_sandbox",
            ["runtime_environment_id"],
            unique=False,
        )
    op.alter_column("cloud_sandbox", "cloud_workspace_id", nullable=True)

    if not _has_column("usage_segment", "runtime_environment_id"):
        op.add_column(
            "usage_segment",
            sa.Column("runtime_environment_id", sa.Uuid(), nullable=True),
        )
    if not _has_index("usage_segment", "ix_usage_segment_runtime_environment_id"):
        op.create_index(
            "ix_usage_segment_runtime_environment_id",
            "usage_segment",
            ["runtime_environment_id"],
            unique=False,
        )
    op.alter_column("usage_segment", "workspace_id", nullable=True)

    if not _has_column("cloud_repo_config", "env_vars_version"):
        op.add_column(
            "cloud_repo_config",
            sa.Column("env_vars_version", sa.Integer(), nullable=False, server_default="0"),
        )
    if not _has_column("cloud_repo_config", "setup_script_version"):
        op.add_column(
            "cloud_repo_config",
            sa.Column("setup_script_version", sa.Integer(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    """Downgrade schema."""
    if _has_column("cloud_repo_config", "setup_script_version"):
        op.drop_column("cloud_repo_config", "setup_script_version")
    if _has_column("cloud_repo_config", "env_vars_version"):
        op.drop_column("cloud_repo_config", "env_vars_version")

    if _has_index("usage_segment", "ix_usage_segment_runtime_environment_id"):
        op.drop_index("ix_usage_segment_runtime_environment_id", table_name="usage_segment")
    if _has_column("usage_segment", "runtime_environment_id"):
        op.drop_column("usage_segment", "runtime_environment_id")
    op.alter_column("usage_segment", "workspace_id", nullable=False)

    if _has_index("cloud_sandbox", "ix_cloud_sandbox_runtime_environment_id"):
        op.drop_index("ix_cloud_sandbox_runtime_environment_id", table_name="cloud_sandbox")
    if _has_column("cloud_sandbox", "runtime_environment_id"):
        op.drop_column("cloud_sandbox", "runtime_environment_id")
    op.alter_column("cloud_sandbox", "cloud_workspace_id", nullable=False)

    if _has_index("cloud_workspace", "uq_cloud_workspace_active_branch"):
        op.drop_index("uq_cloud_workspace_active_branch", table_name="cloud_workspace")
    if _has_index("cloud_workspace", "ix_cloud_workspace_runtime_environment_id"):
        op.drop_index("ix_cloud_workspace_runtime_environment_id", table_name="cloud_workspace")
    for column_name in (
        "cleanup_last_error",
        "cleanup_state",
        "archived_at",
        "archive_requested_at",
        "repo_setup_applied_version",
        "runtime_environment_id",
    ):
        if _has_column("cloud_workspace", column_name):
            op.drop_column("cloud_workspace", column_name)

    if _has_index(
        "cloud_runtime_environment",
        "uq_cloud_runtime_environment_user_repo_policy",
    ):
        op.drop_index(
            "uq_cloud_runtime_environment_user_repo_policy",
            table_name="cloud_runtime_environment",
        )
    for index_name in (
        "ix_cloud_runtime_environment_billing_subject_id",
        "ix_cloud_runtime_environment_created_by_user_id",
        "ix_cloud_runtime_environment_organization_id",
        "ix_cloud_runtime_environment_user_id",
    ):
        if _has_index("cloud_runtime_environment", index_name):
            op.drop_index(index_name, table_name="cloud_runtime_environment")
    if _has_table("cloud_runtime_environment"):
        op.drop_table("cloud_runtime_environment")
