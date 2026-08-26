"""Drop the dark cloud sandbox stack tables (cull A-b part 2).

Removes the tables behind the cloud sandbox stack deleted in the cull
sweep's second slice: sandboxes, workspaces and their materialization
ledgers, secret sets, the target-scoped harness launch-option state, and
integration action approvals. No data is preserved; these surfaces were
gated off in production. CASCADE also drops the runtime-worker tables'
foreign keys onto ``cloud_sandbox`` (those columns stay as bare ids).

The downgrade recreates structure only, following the other cull-sweep
drops: rows are unrecoverable, but a downgrade that passes through this
revision keeps working for the migration suite.

Revision ID: f2a3b4c5d6e7
Revises: c9d1e3f5a7b9
Create Date: 2026-08-26 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "f2a3b4c5d6e7"
down_revision: str | None = "c9d1e3f5a7b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DROPPED_TABLES = (
    "cloud_integration_action_approval_event",
    "cloud_integration_action_approval",
    "cloud_sandbox_secret_materialization",
    "cloud_secret_file",
    "cloud_secret_env_var",
    "cloud_secret_set",
    "cloud_workspace_materialization",
    "cloud_repo_environment_materialization",
    "harness_launch_option_state",
    "cloud_workspace",
    "cloud_sandbox",
)


def upgrade() -> None:
    for table in DROPPED_TABLES:
        op.execute(f'DROP TABLE IF EXISTS "{table}" CASCADE')


def downgrade() -> None:
    # Structure only: deleted rows are unrecoverable without a snapshot.
    op.create_table(
        "cloud_sandbox",
        sa.Column("id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column("status", sa.VARCHAR(length=32), autoincrement=False, nullable=False),
        sa.Column(
            "created_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=False
        ),
        sa.Column(
            "updated_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=False
        ),
        sa.Column(
            "sandbox_type",
            sa.VARCHAR(length=32),
            server_default=sa.text("'e2b'::character varying"),
            autoincrement=False,
            nullable=False,
        ),
        sa.Column(
            "provider_sandbox_id", sa.VARCHAR(length=255), autoincrement=False, nullable=True
        ),
        sa.Column("owner_user_id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column("anyharness_base_url", sa.TEXT(), autoincrement=False, nullable=True),
        sa.Column("runtime_token_ciphertext", sa.TEXT(), autoincrement=False, nullable=True),
        sa.Column("anyharness_data_key_ciphertext", sa.TEXT(), autoincrement=False, nullable=True),
        sa.Column(
            "ready_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True
        ),
        sa.Column(
            "last_health_at",
            postgresql.TIMESTAMP(timezone=True),
            autoincrement=False,
            nullable=True,
        ),
        sa.Column(
            "destroyed_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True
        ),
        sa.Column(
            "desired_anyharness_version", sa.VARCHAR(length=64), autoincrement=False, nullable=True
        ),
        sa.Column(
            "desired_worker_version", sa.VARCHAR(length=64), autoincrement=False, nullable=True
        ),
        sa.Column("last_error", sa.TEXT(), autoincrement=False, nullable=True),
        sa.Column(
            "materialization_attempt",
            sa.INTEGER(),
            server_default=sa.text("0"),
            autoincrement=False,
            nullable=False,
        ),
        sa.Column(
            "provider_observed_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            autoincrement=False,
            nullable=False,
        ),
        sa.CheckConstraint("sandbox_type::text = 'e2b'::text", name=op.f("ck_cloud_sandbox_type")),
        sa.CheckConstraint(
            "status::text = ANY (ARRAY['creating'::character varying, 'ready'::character varying, 'paused'::character varying, 'error'::character varying, 'destroyed'::character varying]::text[])",
            name=op.f("ck_cloud_sandbox_status"),
        ),
        sa.ForeignKeyConstraint(
            ["owner_user_id"],
            ["user.id"],
            name=op.f("cloud_sandbox_owner_user_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("cloud_sandbox_pkey")),
    )
    op.create_index(
        op.f("ux_cloud_sandbox_provider_sandbox_id"),
        "cloud_sandbox",
        ["provider_sandbox_id"],
        unique=True,
        postgresql_where="(provider_sandbox_id IS NOT NULL)",
    )
    op.create_index(
        op.f("ux_cloud_sandbox_personal_active"),
        "cloud_sandbox",
        ["owner_user_id"],
        unique=True,
        postgresql_where="(destroyed_at IS NULL)",
    )
    op.create_index(
        op.f("ix_cloud_sandbox_owner_user_status"),
        "cloud_sandbox",
        ["owner_user_id", "status"],
        unique=False,
    )
    op.create_table(
        "cloud_workspace",
        sa.Column("id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column("display_name", sa.VARCHAR(length=255), autoincrement=False, nullable=False),
        sa.Column("git_branch", sa.VARCHAR(length=255), autoincrement=False, nullable=False),
        sa.Column("git_base_branch", sa.VARCHAR(length=255), autoincrement=False, nullable=True),
        sa.Column(
            "anyharness_workspace_id", sa.VARCHAR(length=255), autoincrement=False, nullable=True
        ),
        sa.Column(
            "created_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=False
        ),
        sa.Column(
            "updated_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=False
        ),
        sa.Column(
            "archived_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True
        ),
        sa.Column("owner_user_id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column("repo_environment_id", sa.UUID(), autoincrement=False, nullable=True),
        sa.Column(
            "workspace_kind",
            sa.VARCHAR(length=32),
            server_default=sa.text("'repository_worktree'::character varying"),
            autoincrement=False,
            nullable=False,
        ),
        sa.Column(
            "lost_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True
        ),
        sa.CheckConstraint(
            "workspace_kind::text = 'repository_worktree'::text AND repo_environment_id IS NOT NULL OR workspace_kind::text = 'scratch'::text AND repo_environment_id IS NULL",
            name=op.f("ck_cloud_workspace_kind_repo_environment"),
        ),
        sa.CheckConstraint(
            "workspace_kind::text = ANY (ARRAY['repository_worktree'::character varying, 'scratch'::character varying]::text[])",
            name=op.f("ck_cloud_workspace_kind"),
        ),
        sa.ForeignKeyConstraint(
            ["owner_user_id"],
            ["user.id"],
            name=op.f("cloud_workspace_owner_user_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["repo_environment_id"],
            ["repo_environment.id"],
            name=op.f("cloud_workspace_repo_environment_id_fkey"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("cloud_workspace_pkey")),
    )
    op.create_index(
        op.f("ux_cloud_workspace_anyharness_workspace"),
        "cloud_workspace",
        ["owner_user_id", "anyharness_workspace_id"],
        unique=True,
        postgresql_where="((archived_at IS NULL) AND (anyharness_workspace_id IS NOT NULL))",
    )
    op.create_index(
        op.f("ux_cloud_workspace_active_repo_environment_branch"),
        "cloud_workspace",
        ["owner_user_id", "repo_environment_id", "git_branch"],
        unique=True,
        postgresql_where="((archived_at IS NULL) AND ((workspace_kind)::text = 'repository_worktree'::text))",
    )
    op.create_index(
        op.f("ix_cloud_workspace_repo_environment_id"),
        "cloud_workspace",
        ["repo_environment_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_cloud_workspace_owner_user_id"),
        "cloud_workspace",
        ["owner_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_cloud_workspace_anyharness_workspace_id"),
        "cloud_workspace",
        ["anyharness_workspace_id"],
        unique=False,
    )
    op.create_table(
        "cloud_repo_environment_materialization",
        sa.Column(
            "id",
            sa.UUID(),
            server_default=sa.text("gen_random_uuid()"),
            autoincrement=False,
            nullable=False,
        ),
        sa.Column("cloud_sandbox_id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column("repo_environment_id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column("status", sa.VARCHAR(length=7), autoincrement=False, nullable=False),
        sa.Column(
            "applied_repo_environment_updated_at",
            postgresql.TIMESTAMP(timezone=True),
            autoincrement=False,
            nullable=True,
        ),
        sa.Column("applied_manifest_json", sa.TEXT(), autoincrement=False, nullable=True),
        sa.Column("last_error", sa.TEXT(), autoincrement=False, nullable=True),
        sa.Column(
            "materialized_at",
            postgresql.TIMESTAMP(timezone=True),
            autoincrement=False,
            nullable=True,
        ),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            autoincrement=False,
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            autoincrement=False,
            nullable=False,
        ),
        sa.CheckConstraint(
            "status::text = ANY (ARRAY['pending'::character varying, 'running'::character varying, 'ready'::character varying, 'error'::character varying]::text[])",
            name=op.f("ck_cloud_repo_environment_materialization_status"),
        ),
        sa.ForeignKeyConstraint(
            ["cloud_sandbox_id"],
            ["cloud_sandbox.id"],
            name=op.f("cloud_repo_environment_materialization_cloud_sandbox_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["repo_environment_id"],
            ["repo_environment.id"],
            name=op.f("cloud_repo_environment_materialization_repo_environment_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("cloud_repo_environment_materialization_pkey")),
    )
    op.create_index(
        op.f("ux_cloud_repo_environment_materialization"),
        "cloud_repo_environment_materialization",
        ["cloud_sandbox_id", "repo_environment_id"],
        unique=True,
    )
    op.create_index(
        op.f("ix_cloud_repo_environment_materialization_status"),
        "cloud_repo_environment_materialization",
        ["cloud_sandbox_id", "status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_cloud_repo_environment_materialization_repo_environment_id"),
        "cloud_repo_environment_materialization",
        ["repo_environment_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_cloud_repo_environment_materialization_cloud_sandbox_id"),
        "cloud_repo_environment_materialization",
        ["cloud_sandbox_id"],
        unique=False,
    )
    op.create_table(
        "cloud_workspace_materialization",
        sa.Column("id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column("cloud_workspace_id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column("target_kind", sa.VARCHAR(length=32), autoincrement=False, nullable=False),
        sa.Column("cloud_sandbox_id", sa.UUID(), autoincrement=False, nullable=True),
        sa.Column(
            "desktop_install_id", sa.VARCHAR(length=255), autoincrement=False, nullable=True
        ),
        sa.Column(
            "anyharness_workspace_id", sa.VARCHAR(length=255), autoincrement=False, nullable=True
        ),
        sa.Column("worktree_path", sa.TEXT(), autoincrement=False, nullable=True),
        sa.Column("state", sa.VARCHAR(length=32), autoincrement=False, nullable=False),
        sa.Column(
            "generation",
            sa.INTEGER(),
            server_default=sa.text("1"),
            autoincrement=False,
            nullable=False,
        ),
        sa.Column("expected_head_sha", sa.VARCHAR(length=64), autoincrement=False, nullable=True),
        sa.Column("observed_head_sha", sa.VARCHAR(length=64), autoincrement=False, nullable=True),
        sa.Column("observed_branch", sa.VARCHAR(length=255), autoincrement=False, nullable=True),
        sa.Column("failure_code", sa.VARCHAR(length=255), autoincrement=False, nullable=True),
        sa.Column("failure_detail", sa.TEXT(), autoincrement=False, nullable=True),
        sa.Column(
            "last_reported_at",
            postgresql.TIMESTAMP(timezone=True),
            autoincrement=False,
            nullable=True,
        ),
        sa.Column(
            "unlinked_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True
        ),
        sa.Column(
            "created_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=False
        ),
        sa.Column(
            "updated_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=False
        ),
        sa.CheckConstraint(
            "state::text = ANY (ARRAY['pending'::character varying, 'hydrating'::character varying, 'hydrated'::character varying, 'missing'::character varying, 'inconsistent'::character varying, 'failed'::character varying]::text[])",
            name=op.f("ck_cloud_workspace_materialization_state"),
        ),
        sa.CheckConstraint(
            "target_kind::text = 'managed_cloud'::text AND desktop_install_id IS NULL OR target_kind::text = 'local_desktop'::text AND desktop_install_id IS NOT NULL AND cloud_sandbox_id IS NULL",
            name=op.f("ck_cloud_workspace_materialization_kind_fields"),
        ),
        sa.CheckConstraint(
            "target_kind::text = ANY (ARRAY['managed_cloud'::character varying, 'local_desktop'::character varying]::text[])",
            name=op.f("ck_cloud_workspace_materialization_target_kind"),
        ),
        sa.CheckConstraint(
            "generation >= 1", name=op.f("ck_cloud_workspace_materialization_generation")
        ),
        sa.ForeignKeyConstraint(
            ["cloud_sandbox_id"],
            ["cloud_sandbox.id"],
            name=op.f("cloud_workspace_materialization_cloud_sandbox_id_fkey"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["cloud_workspace_id"],
            ["cloud_workspace.id"],
            name=op.f("cloud_workspace_materialization_cloud_workspace_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("cloud_workspace_materialization_pkey")),
    )
    op.create_index(
        op.f("ux_cloud_workspace_materialization_active_sandbox_runtime"),
        "cloud_workspace_materialization",
        ["cloud_sandbox_id", "anyharness_workspace_id"],
        unique=True,
        postgresql_where="((cloud_sandbox_id IS NOT NULL) AND (anyharness_workspace_id IS NOT NULL) AND (unlinked_at IS NULL))",
    )
    op.create_index(
        op.f("ux_cloud_workspace_materialization_active_managed"),
        "cloud_workspace_materialization",
        ["cloud_workspace_id"],
        unique=True,
        postgresql_where="(((target_kind)::text = 'managed_cloud'::text) AND (unlinked_at IS NULL))",
    )
    op.create_index(
        op.f("ux_cloud_workspace_materialization_active_local"),
        "cloud_workspace_materialization",
        ["cloud_workspace_id", "desktop_install_id"],
        unique=True,
        postgresql_where="(((target_kind)::text = 'local_desktop'::text) AND (unlinked_at IS NULL))",
    )
    op.create_index(
        op.f("ux_cloud_workspace_materialization_active_install_runtime"),
        "cloud_workspace_materialization",
        ["desktop_install_id", "anyharness_workspace_id"],
        unique=True,
        postgresql_where="((desktop_install_id IS NOT NULL) AND (anyharness_workspace_id IS NOT NULL) AND (unlinked_at IS NULL))",
    )
    op.create_index(
        op.f("ix_cloud_workspace_materialization_cloud_workspace_id"),
        "cloud_workspace_materialization",
        ["cloud_workspace_id"],
        unique=False,
    )
    op.create_table(
        "harness_launch_option_state",
        sa.Column("cloud_sandbox_id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column("harness_kind", sa.VARCHAR(length=64), autoincrement=False, nullable=False),
        sa.Column("source_revision", sa.BIGINT(), autoincrement=False, nullable=False),
        sa.Column("payload_json", sa.TEXT(), autoincrement=False, nullable=False),
        sa.Column(
            "copied_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            autoincrement=False,
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["cloud_sandbox_id"],
            ["cloud_sandbox.id"],
            name=op.f("harness_launch_option_state_cloud_sandbox_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "cloud_sandbox_id", "harness_kind", name=op.f("harness_launch_option_state_pkey")
        ),
    )
    op.create_table(
        "cloud_secret_set",
        sa.Column("id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column("scope_kind", sa.VARCHAR(length=32), autoincrement=False, nullable=False),
        sa.Column("user_id", sa.UUID(), autoincrement=False, nullable=True),
        sa.Column("organization_id", sa.UUID(), autoincrement=False, nullable=True),
        sa.Column("version", sa.INTEGER(), autoincrement=False, nullable=False),
        sa.Column("created_by_user_id", sa.UUID(), autoincrement=False, nullable=True),
        sa.Column("updated_by_user_id", sa.UUID(), autoincrement=False, nullable=True),
        sa.Column(
            "created_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=False
        ),
        sa.Column(
            "updated_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=False
        ),
        sa.Column("repo_environment_id", sa.UUID(), autoincrement=False, nullable=True),
        sa.CheckConstraint(
            "scope_kind::text = 'personal'::text AND user_id IS NOT NULL AND organization_id IS NULL AND repo_environment_id IS NULL OR scope_kind::text = 'organization'::text AND organization_id IS NOT NULL AND user_id IS NULL AND repo_environment_id IS NULL OR scope_kind::text = 'workspace'::text AND repo_environment_id IS NOT NULL AND user_id IS NULL AND organization_id IS NULL",
            name=op.f("ck_cloud_secret_set_scope_fields"),
        ),
        sa.CheckConstraint(
            "scope_kind::text = ANY (ARRAY['personal'::character varying, 'organization'::character varying, 'workspace'::character varying]::text[])",
            name=op.f("ck_cloud_secret_set_scope_kind"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["user.id"],
            name=op.f("cloud_secret_set_created_by_user_id_fkey"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organization.id"],
            name=op.f("cloud_secret_set_organization_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["repo_environment_id"],
            ["repo_environment.id"],
            name=op.f("fk_cloud_secret_set_repo_environment_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"],
            ["user.id"],
            name=op.f("cloud_secret_set_updated_by_user_id_fkey"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user.id"],
            name=op.f("cloud_secret_set_user_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("cloud_secret_set_pkey")),
    )
    op.create_index(
        op.f("ux_cloud_secret_set_workspace_environment"),
        "cloud_secret_set",
        ["repo_environment_id"],
        unique=True,
        postgresql_where="((scope_kind)::text = 'workspace'::text)",
    )
    op.create_index(
        op.f("ux_cloud_secret_set_personal"),
        "cloud_secret_set",
        ["user_id"],
        unique=True,
        postgresql_where="((scope_kind)::text = 'personal'::text)",
    )
    op.create_index(
        op.f("ux_cloud_secret_set_organization"),
        "cloud_secret_set",
        ["organization_id"],
        unique=True,
        postgresql_where="((scope_kind)::text = 'organization'::text)",
    )
    op.create_index(
        op.f("ix_cloud_secret_set_user_id"), "cloud_secret_set", ["user_id"], unique=False
    )
    op.create_index(
        op.f("ix_cloud_secret_set_scope_kind"), "cloud_secret_set", ["scope_kind"], unique=False
    )
    op.create_index(
        op.f("ix_cloud_secret_set_repo_environment_id"),
        "cloud_secret_set",
        ["repo_environment_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_cloud_secret_set_organization_id"),
        "cloud_secret_set",
        ["organization_id"],
        unique=False,
    )
    op.create_table(
        "cloud_secret_env_var",
        sa.Column("id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column("secret_set_id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column("name", sa.VARCHAR(length=255), autoincrement=False, nullable=False),
        sa.Column("value_ciphertext", sa.TEXT(), autoincrement=False, nullable=False),
        sa.Column("value_sha256", sa.VARCHAR(length=64), autoincrement=False, nullable=False),
        sa.Column("byte_size", sa.BIGINT(), autoincrement=False, nullable=False),
        sa.Column(
            "created_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=False
        ),
        sa.Column(
            "updated_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["secret_set_id"],
            ["cloud_secret_set.id"],
            name=op.f("cloud_secret_env_var_secret_set_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("cloud_secret_env_var_pkey")),
        sa.UniqueConstraint(
            "secret_set_id",
            "name",
            name=op.f("cloud_secret_env_var_secret_set_id_name_key"),
            postgresql_include=[],
            postgresql_nulls_not_distinct=False,
        ),
    )
    op.create_index(
        op.f("ix_cloud_secret_env_var_secret_set_id"),
        "cloud_secret_env_var",
        ["secret_set_id"],
        unique=False,
    )
    op.create_table(
        "cloud_secret_file",
        sa.Column("id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column("secret_set_id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column("path", sa.TEXT(), autoincrement=False, nullable=False),
        sa.Column("content_ciphertext", sa.TEXT(), autoincrement=False, nullable=False),
        sa.Column("content_sha256", sa.VARCHAR(length=64), autoincrement=False, nullable=False),
        sa.Column("byte_size", sa.BIGINT(), autoincrement=False, nullable=False),
        sa.Column(
            "created_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=False
        ),
        sa.Column(
            "updated_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["secret_set_id"],
            ["cloud_secret_set.id"],
            name=op.f("cloud_secret_file_secret_set_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("cloud_secret_file_pkey")),
        sa.UniqueConstraint(
            "secret_set_id",
            "path",
            name=op.f("cloud_secret_file_secret_set_id_path_key"),
            postgresql_include=[],
            postgresql_nulls_not_distinct=False,
        ),
    )
    op.create_index(
        op.f("ix_cloud_secret_file_secret_set_id"),
        "cloud_secret_file",
        ["secret_set_id"],
        unique=False,
    )
    op.create_table(
        "cloud_sandbox_secret_materialization",
        sa.Column("id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column("cloud_sandbox_id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column(
            "materialization_kind", sa.VARCHAR(length=32), autoincrement=False, nullable=False
        ),
        sa.Column("cloud_secret_set_id", sa.UUID(), autoincrement=False, nullable=True),
        sa.Column("sandbox_generation", sa.INTEGER(), autoincrement=False, nullable=False),
        sa.Column("applied_version", sa.INTEGER(), autoincrement=False, nullable=False),
        sa.Column("applied_versions_json", sa.TEXT(), autoincrement=False, nullable=True),
        sa.Column("applied_manifest_json", sa.TEXT(), autoincrement=False, nullable=True),
        sa.Column("status", sa.VARCHAR(length=32), autoincrement=False, nullable=False),
        sa.Column("last_error", sa.TEXT(), autoincrement=False, nullable=True),
        sa.Column(
            "materialized_at",
            postgresql.TIMESTAMP(timezone=True),
            autoincrement=False,
            nullable=True,
        ),
        sa.Column(
            "created_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=False
        ),
        sa.Column(
            "updated_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=False
        ),
        sa.Column("repo_environment_id", sa.UUID(), autoincrement=False, nullable=True),
        sa.CheckConstraint(
            "materialization_kind::text = 'global'::text AND repo_environment_id IS NULL OR materialization_kind::text = 'workspace'::text AND repo_environment_id IS NOT NULL",
            name=op.f("ck_cloud_sandbox_secret_materialization_scope"),
        ),
        sa.CheckConstraint(
            "materialization_kind::text = ANY (ARRAY['global'::character varying, 'workspace'::character varying]::text[])",
            name=op.f("ck_cloud_sandbox_secret_materialization_kind"),
        ),
        sa.CheckConstraint(
            "status::text = ANY (ARRAY['pending'::character varying, 'running'::character varying, 'ready'::character varying, 'error'::character varying]::text[])",
            name=op.f("ck_cloud_sandbox_secret_materialization_status"),
        ),
        sa.ForeignKeyConstraint(
            ["cloud_sandbox_id"],
            ["cloud_sandbox.id"],
            name=op.f("cloud_sandbox_secret_materialization_cloud_sandbox_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["cloud_secret_set_id"],
            ["cloud_secret_set.id"],
            name=op.f("managed_sandbox_secret_materialization_cloud_secret_set_id_fkey"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["repo_environment_id"],
            ["repo_environment.id"],
            name=op.f("cloud_sandbox_secret_materialization_repo_environment_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("managed_sandbox_secret_materialization_pkey")),
    )
    op.create_index(
        op.f("ux_cloud_sandbox_secret_materialization_workspace_environment"),
        "cloud_sandbox_secret_materialization",
        ["cloud_sandbox_id", "repo_environment_id"],
        unique=True,
        postgresql_where="((materialization_kind)::text = 'workspace'::text)",
    )
    op.create_index(
        op.f("ux_cloud_sandbox_secret_materialization_global"),
        "cloud_sandbox_secret_materialization",
        ["cloud_sandbox_id"],
        unique=True,
        postgresql_where="((materialization_kind)::text = 'global'::text)",
    )
    op.create_index(
        op.f("ix_managed_sandbox_secret_materialization_repo_environment_id"),
        "cloud_sandbox_secret_materialization",
        ["repo_environment_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_managed_sandbox_secret_materialization_cloud_secret_set_id"),
        "cloud_sandbox_secret_materialization",
        ["cloud_secret_set_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_cloud_sandbox_secret_materialization_status"),
        "cloud_sandbox_secret_materialization",
        ["cloud_sandbox_id", "status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_cloud_sandbox_secret_materialization_materialization_kind"),
        "cloud_sandbox_secret_materialization",
        ["materialization_kind"],
        unique=False,
    )
    op.create_table(
        "cloud_integration_action_approval",
        sa.Column(
            "id",
            sa.UUID(),
            server_default=sa.text("gen_random_uuid()"),
            autoincrement=False,
            nullable=False,
        ),
        sa.Column("owner_user_id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column("organization_id", sa.UUID(), autoincrement=False, nullable=True),
        sa.Column("integration_account_id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column(
            "integration_account_auth_version", sa.INTEGER(), autoincrement=False, nullable=False
        ),
        sa.Column("runtime_worker_id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column("gateway_session_id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column("workspace_id", sa.VARCHAR(length=255), autoincrement=False, nullable=False),
        sa.Column(
            "anyharness_session_id", sa.VARCHAR(length=255), autoincrement=False, nullable=False
        ),
        sa.Column(
            "provider_namespace", sa.VARCHAR(length=64), autoincrement=False, nullable=False
        ),
        sa.Column("tool_name", sa.VARCHAR(length=255), autoincrement=False, nullable=False),
        sa.Column("payload_digest", sa.VARCHAR(length=64), autoincrement=False, nullable=False),
        sa.Column("binding_digest", sa.VARCHAR(length=64), autoincrement=False, nullable=False),
        sa.Column("idempotency_key", sa.VARCHAR(length=64), autoincrement=False, nullable=False),
        sa.Column(
            "safe_action_summary", sa.VARCHAR(length=512), autoincrement=False, nullable=False
        ),
        sa.Column(
            "safe_account_label", sa.VARCHAR(length=255), autoincrement=False, nullable=False
        ),
        sa.Column(
            "safe_source_label", sa.VARCHAR(length=255), autoincrement=False, nullable=False
        ),
        sa.Column("safe_target", sa.VARCHAR(length=255), autoincrement=False, nullable=True),
        sa.Column(
            "safe_content_preview", sa.VARCHAR(length=512), autoincrement=False, nullable=True
        ),
        sa.Column(
            "safe_content_character_count", sa.INTEGER(), autoincrement=False, nullable=True
        ),
        sa.Column("status", sa.VARCHAR(length=32), autoincrement=False, nullable=False),
        sa.Column(
            "expires_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=False
        ),
        sa.Column(
            "approved_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True
        ),
        sa.Column(
            "rejected_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True
        ),
        sa.Column(
            "revoked_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True
        ),
        sa.Column(
            "consumed_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True
        ),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            autoincrement=False,
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            autoincrement=False,
            nullable=False,
        ),
        sa.CheckConstraint(
            "status::text = ANY (ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying, 'consumed'::character varying, 'expired'::character varying, 'revoked'::character varying]::text[])",
            name=op.f("ck_cloud_integration_action_approval_status"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("cloud_integration_action_approval_pkey")),
    )
    op.create_index(
        op.f("ux_cloud_integration_action_approval_active_key"),
        "cloud_integration_action_approval",
        ["idempotency_key"],
        unique=True,
        postgresql_where="((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying])::text[]))",
    )
    op.create_index(
        op.f("ix_cloud_integration_action_approval_owner_status_created"),
        "cloud_integration_action_approval",
        ["owner_user_id", "status", "created_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_cloud_integration_action_approval_expires_at"),
        "cloud_integration_action_approval",
        ["expires_at"],
        unique=False,
    )
    op.create_table(
        "cloud_integration_action_approval_event",
        sa.Column(
            "id",
            sa.UUID(),
            server_default=sa.text("gen_random_uuid()"),
            autoincrement=False,
            nullable=False,
        ),
        sa.Column("approval_id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column("event_type", sa.VARCHAR(length=32), autoincrement=False, nullable=False),
        sa.Column("from_status", sa.VARCHAR(length=32), autoincrement=False, nullable=True),
        sa.Column("to_status", sa.VARCHAR(length=32), autoincrement=False, nullable=False),
        sa.Column("actor_type", sa.VARCHAR(length=32), autoincrement=False, nullable=False),
        sa.Column("actor_user_id", sa.UUID(), autoincrement=False, nullable=True),
        sa.Column("actor_runtime_worker_id", sa.UUID(), autoincrement=False, nullable=True),
        sa.Column(
            "safe_action_summary", sa.VARCHAR(length=512), autoincrement=False, nullable=False
        ),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            autoincrement=False,
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            autoincrement=False,
            nullable=False,
        ),
        sa.CheckConstraint(
            "actor_type::text = 'user'::text AND actor_user_id IS NOT NULL AND actor_runtime_worker_id IS NULL OR actor_type::text = 'runtime_worker'::text AND actor_user_id IS NULL AND actor_runtime_worker_id IS NOT NULL OR actor_type::text = 'system'::text AND actor_user_id IS NULL AND actor_runtime_worker_id IS NULL",
            name=op.f("ck_cloud_integration_action_approval_event_actor_shape"),
        ),
        sa.CheckConstraint(
            "actor_type::text = ANY (ARRAY['user'::character varying, 'runtime_worker'::character varying, 'system'::character varying]::text[])",
            name=op.f("ck_cloud_integration_action_approval_event_actor_type"),
        ),
        sa.CheckConstraint(
            "event_type::text = ANY (ARRAY['requested'::character varying, 'approved'::character varying, 'rejected'::character varying, 'revoked'::character varying, 'expired'::character varying, 'consumed'::character varying]::text[])",
            name=op.f("ck_cloud_integration_action_approval_event_type"),
        ),
        sa.ForeignKeyConstraint(
            ["approval_id"],
            ["cloud_integration_action_approval.id"],
            name=op.f("cloud_integration_action_approval_event_approval_id_fkey"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("cloud_integration_action_approval_event_pkey")),
    )
    op.create_index(
        op.f("ix_cloud_integration_action_approval_event_approval_created"),
        "cloud_integration_action_approval_event",
        ["approval_id", "created_at"],
        unique=False,
    )
    op.create_foreign_key(
        op.f("cloud_runtime_worker_enrollment_cloud_sandbox_id_fkey"),
        "cloud_runtime_worker_enrollment",
        "cloud_sandbox",
        ["cloud_sandbox_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        op.f("cloud_runtime_worker_cloud_sandbox_id_fkey"),
        "cloud_runtime_worker",
        "cloud_sandbox",
        ["cloud_sandbox_id"],
        ["id"],
        ondelete="CASCADE",
    )
