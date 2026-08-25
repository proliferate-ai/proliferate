"""Drop the zero-consumer dark cloud tables (cull A-b part 1).

Removes the tables behind the dark systems deleted in the cull sweep's
first slice: agent run configs and the worktree retention policy. No data
is preserved; these surfaces were gated off in production and had no live
consumers. CASCADE also removes inbound foreign keys from still-standing
tables.

The downgrade recreates structure only, following the other cull-sweep
drops (gen-1 workflow lane, SSO): rows are unrecoverable, but a downgrade
that passes through this revision keeps working for the migration suite.

Revision ID: c9d1e3f5a7b9
Revises: cd15ae907558
Create Date: 2026-08-25 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c9d1e3f5a7b9"
down_revision: str | None = "cd15ae907558"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DROPPED_TABLES = (
    "cloud_agent_run_config_default",
    "cloud_agent_run_config",
    "cloud_worktree_retention_policy",
)

_AGENT_KINDS = "agent_kind IN ('claude', 'codex', 'opencode', 'cursor', 'grok')"


def upgrade() -> None:
    for table in DROPPED_TABLES:
        op.execute(f'DROP TABLE IF EXISTS "{table}" CASCADE')


def downgrade() -> None:
    # Structure only: deleted rows are unrecoverable without a snapshot.
    op.create_table(
        "cloud_worktree_retention_policy",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("max_materialized_worktrees_per_repo", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "max_materialized_worktrees_per_repo >= 10 "
            "AND max_materialized_worktrees_per_repo <= 100",
            name="ck_cloud_worktree_retention_policy_limit",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_cloud_worktree_retention_policy_user_id"),
    )
    op.create_index(
        "ix_cloud_worktree_retention_policy_user_id",
        "cloud_worktree_retention_policy",
        ["user_id"],
    )

    op.create_table(
        "cloud_agent_run_config",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_scope", sa.String(length=32), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=True),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("agent_kind", sa.String(length=32), nullable=False),
        sa.Column("model_id", sa.String(length=255), nullable=False),
        sa.Column(
            "control_values_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "usable_in_personal_sandboxes",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "usable_in_shared_sandboxes",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("seed_key", sa.String(length=128), nullable=True),
        sa.Column("system_default_rank", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=32),
            server_default=sa.text("'active'"),
            nullable=False,
        ),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "owner_scope IN ('system', 'personal', 'organization')",
            name="ck_cloud_agent_run_config_owner_scope",
        ),
        sa.CheckConstraint(
            "((owner_scope = 'system' AND owner_user_id IS NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL) "
            "OR (owner_scope = 'organization' AND organization_id IS NOT NULL "
            "AND owner_user_id IS NULL))",
            name="ck_cloud_agent_run_config_owner_fields",
        ),
        sa.CheckConstraint(_AGENT_KINDS, name="ck_cloud_agent_run_config_agent_kind"),
        sa.CheckConstraint(
            "status IN ('active', 'archived')",
            name="ck_cloud_agent_run_config_status",
        ),
        sa.CheckConstraint(
            "((owner_scope = 'system' AND seed_key IS NOT NULL) OR "
            "(owner_scope != 'system' AND seed_key IS NULL AND system_default_rank IS NULL))",
            name="ck_cloud_agent_run_config_seed_fields",
        ),
        sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_cloud_agent_run_config_owner_user", "cloud_agent_run_config", ["owner_user_id"]
    )
    op.create_index(
        "ix_cloud_agent_run_config_organization", "cloud_agent_run_config", ["organization_id"]
    )
    op.create_index(
        "ix_cloud_agent_run_config_agent_kind", "cloud_agent_run_config", ["agent_kind"]
    )
    op.create_index(
        "ux_cloud_agent_run_config_system_seed",
        "cloud_agent_run_config",
        ["agent_kind", "seed_key"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'system'"),
    )

    op.create_table(
        "cloud_agent_run_config_default",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_scope", sa.String(length=32), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=True),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("agent_kind", sa.String(length=32), nullable=False),
        sa.Column("config_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "owner_scope IN ('personal', 'organization')",
            name="ck_cloud_agent_run_config_default_owner_scope",
        ),
        sa.CheckConstraint(
            "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL) "
            "OR (owner_scope = 'organization' AND organization_id IS NOT NULL "
            "AND owner_user_id IS NULL))",
            name="ck_cloud_agent_run_config_default_owner_fields",
        ),
        sa.CheckConstraint(_AGENT_KINDS, name="ck_cloud_agent_run_config_default_agent_kind"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["config_id"], ["cloud_agent_run_config.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ux_cloud_agent_run_config_default_user",
        "cloud_agent_run_config_default",
        ["owner_user_id", "agent_kind"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'personal'"),
    )
    op.create_index(
        "ux_cloud_agent_run_config_default_org",
        "cloud_agent_run_config_default",
        ["organization_id", "agent_kind"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'organization'"),
    )
