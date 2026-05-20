"""Add managed sandbox profile foundation.

Revision ID: f0a1b2c3d4e5
Revises: e7f8a9b0c1d2
Create Date: 2026-05-20 12:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "f0a1b2c3d4e5"
down_revision: str | None = "e7f8a9b0c1d2"
branch_labels: str | None = None
depends_on: str | None = None

_PROFILE_STATUSES = ("configuring", "provisioning", "active", "disabled", "blocked", "error")
_TARGET_STATE_STATUSES = ("pending", "materializing", "applied", "failed", "superseded")
_TARGET_ROLES = ("primary", "none")


def _in_constraint(column_name: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column_name} IN ({quoted})"


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)
    }


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return index_name in {
        index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table_name)
    }


def _has_constraint(table_name: str, constraint_name: str) -> bool:
    if not _has_table(table_name):
        return False
    inspector = sa.inspect(op.get_bind())
    names = {constraint["name"] for constraint in inspector.get_check_constraints(table_name)}
    names.update(constraint["name"] for constraint in inspector.get_foreign_keys(table_name))
    names.update(constraint["name"] for constraint in inspector.get_unique_constraints(table_name))
    return constraint_name in names


def _drop_index_once(index_name: str, table_name: str) -> None:
    if _has_index(table_name, index_name):
        op.drop_index(index_name, table_name=table_name)


def _drop_constraint_once(
    constraint_name: str,
    table_name: str,
    constraint_type: str,
) -> None:
    if _has_constraint(table_name, constraint_name):
        op.drop_constraint(constraint_name, table_name, type_=constraint_type)


def _create_index_once(
    index_name: str,
    table_name: str,
    columns: list[str],
    **kwargs: object,
) -> None:
    if all(_has_column(table_name, column) for column in columns) and not _has_index(
        table_name,
        index_name,
    ):
        op.create_index(index_name, table_name, columns, **kwargs)


def _add_column_once(table_name: str, column: sa.Column) -> None:
    if not _has_column(table_name, column.name):
        op.add_column(table_name, column)


def upgrade() -> None:
    if _schema_already_upgraded():
        if _has_table("sandbox_profile_agent_auth_target_state"):
            op.drop_table("sandbox_profile_agent_auth_target_state")
        return
    _upgrade_sandbox_profile()
    _upgrade_cloud_targets()
    _upgrade_cloud_sandbox()
    _create_cloud_target_runtime_access()
    _replace_profile_target_state()
    _upgrade_cloud_workspace()
    _upgrade_cloud_commands()


def _schema_already_upgraded() -> bool:
    return (
        _has_column("sandbox_profile", "desired_agent_auth_revision")
        and not _has_column("sandbox_profile", "agent_auth_revision")
        and _has_table("cloud_target_runtime_access")
        and _has_table("sandbox_profile_target_state")
        and _has_column("cloud_commands", "cloud_workspace_id")
        and _has_column("cloud_sandbox", "slot_generation")
    )


def downgrade() -> None:
    raise RuntimeError(
        "Downgrade for sandbox profile foundation is unsupported; restore from backup "
        "or migrate forward."
    )


def _upgrade_sandbox_profile() -> None:
    _add_column_once("sandbox_profile", sa.Column("billing_subject_id", sa.Uuid(), nullable=True))
    _add_column_once("sandbox_profile", sa.Column("created_by_user_id", sa.Uuid(), nullable=True))
    _add_column_once(
        "sandbox_profile",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    _add_column_once(
        "sandbox_profile",
        sa.Column("desired_agent_auth_revision", sa.Integer(), nullable=True),
    )

    op.execute(
        """
        INSERT INTO billing_subject (id, kind, user_id, organization_id, created_at, updated_at)
        SELECT gen_random_uuid(), 'personal', sp.owner_user_id, NULL, now(), now()
        FROM sandbox_profile sp
        WHERE sp.owner_scope = 'personal'
          AND sp.owner_user_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM billing_subject bs
            WHERE bs.kind = 'personal' AND bs.user_id = sp.owner_user_id
          )
        """
    )
    op.execute(
        """
        INSERT INTO billing_subject (id, kind, user_id, organization_id, created_at, updated_at)
        SELECT gen_random_uuid(), 'organization', NULL, sp.organization_id, now(), now()
        FROM sandbox_profile sp
        WHERE sp.owner_scope = 'organization'
          AND sp.organization_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM billing_subject bs
            WHERE bs.kind = 'organization' AND bs.organization_id = sp.organization_id
          )
        """
    )
    op.execute(
        """
        UPDATE sandbox_profile sp
        SET billing_subject_id = bs.id
        FROM billing_subject bs
        WHERE sp.billing_subject_id IS NULL
          AND (
            (sp.owner_scope = 'personal' AND bs.kind = 'personal'
             AND bs.user_id = sp.owner_user_id)
            OR
            (sp.owner_scope = 'organization' AND bs.kind = 'organization'
             AND bs.organization_id = sp.organization_id)
          )
        """
    )
    op.execute(
        """
        UPDATE sandbox_profile
        SET desired_agent_auth_revision = agent_auth_revision,
            archived_at = COALESCE(archived_at, deleted_at),
            created_by_user_id = COALESCE(created_by_user_id, owner_user_id),
            status = CASE WHEN status = 'archived' THEN 'disabled' ELSE status END
        """
    )
    _drop_index_once("uq_sandbox_profile_active_personal_user", "sandbox_profile")
    _drop_index_once("uq_sandbox_profile_active_organization", "sandbox_profile")
    _drop_index_once("ix_sandbox_profile_managed_target_id", "sandbox_profile")
    _drop_constraint_once("ck_sandbox_profile_status", "sandbox_profile", "check")
    _drop_constraint_once(
        "sandbox_profile_managed_target_id_fkey",
        "sandbox_profile",
        "foreignkey",
    )
    if _has_column("sandbox_profile", "managed_target_id"):
        op.drop_column("sandbox_profile", "managed_target_id")
    if _has_column("sandbox_profile", "agent_auth_revision"):
        op.drop_column("sandbox_profile", "agent_auth_revision")
    op.alter_column("sandbox_profile", "billing_subject_id", nullable=False)
    op.alter_column("sandbox_profile", "desired_agent_auth_revision", nullable=False)
    op.create_check_constraint(
        "ck_sandbox_profile_status",
        "sandbox_profile",
        _in_constraint("status", _PROFILE_STATUSES),
    )
    op.create_foreign_key(
        "sandbox_profile_billing_subject_id_fkey",
        "sandbox_profile",
        "billing_subject",
        ["billing_subject_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "sandbox_profile_created_by_user_id_fkey",
        "sandbox_profile",
        "user",
        ["created_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    _create_index_once(
        "ix_sandbox_profile_billing_subject_id", "sandbox_profile", ["billing_subject_id"]
    )
    _create_index_once(
        "ix_sandbox_profile_created_by_user_id", "sandbox_profile", ["created_by_user_id"]
    )
    op.create_index(
        "uq_sandbox_profile_active_personal_user",
        "sandbox_profile",
        ["owner_user_id"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'personal' AND archived_at IS NULL"),
    )
    op.create_index(
        "uq_sandbox_profile_active_organization",
        "sandbox_profile",
        ["organization_id"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'organization' AND archived_at IS NULL"),
    )


def _upgrade_cloud_targets() -> None:
    _add_column_once("cloud_targets", sa.Column("sandbox_profile_id", sa.Uuid(), nullable=True))
    _add_column_once(
        "cloud_targets",
        sa.Column("profile_target_role", sa.String(length=32), nullable=True),
    )
    op.execute(
        "UPDATE cloud_targets SET profile_target_role = 'none' WHERE profile_target_role IS NULL"
    )
    op.execute("UPDATE cloud_targets SET owner_user_id = NULL WHERE owner_scope = 'organization'")
    op.alter_column("cloud_targets", "owner_user_id", nullable=True)
    op.alter_column("cloud_targets", "profile_target_role", nullable=False)
    op.create_foreign_key(
        "cloud_targets_sandbox_profile_id_fkey",
        "cloud_targets",
        "sandbox_profile",
        ["sandbox_profile_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_check_constraint(
        "ck_cloud_target_owner_fields",
        "cloud_targets",
        "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
        "AND organization_id IS NULL) OR "
        "(owner_scope = 'organization' AND organization_id IS NOT NULL "
        "AND owner_user_id IS NULL))",
    )
    op.create_check_constraint(
        "ck_cloud_target_profile_role",
        "cloud_targets",
        _in_constraint("profile_target_role", _TARGET_ROLES),
    )
    op.create_check_constraint(
        "ck_cloud_target_primary_requires_profile",
        "cloud_targets",
        "profile_target_role != 'primary' "
        "OR (kind = 'managed_cloud' AND sandbox_profile_id IS NOT NULL)",
    )
    _create_index_once(
        "ix_cloud_targets_sandbox_profile_id", "cloud_targets", ["sandbox_profile_id"]
    )
    op.create_index(
        "ux_cloud_target_primary_per_profile",
        "cloud_targets",
        ["sandbox_profile_id"],
        unique=True,
        postgresql_where=sa.text("profile_target_role = 'primary' AND archived_at IS NULL"),
    )

    _add_column_once("cloud_workers", sa.Column("cloud_sandbox_id", sa.Uuid(), nullable=True))
    _add_column_once("cloud_workers", sa.Column("slot_generation", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "cloud_workers_cloud_sandbox_id_fkey",
        "cloud_workers",
        "cloud_sandbox",
        ["cloud_sandbox_id"],
        ["id"],
        ondelete="SET NULL",
    )
    _create_index_once("ix_cloud_workers_cloud_sandbox_id", "cloud_workers", ["cloud_sandbox_id"])

    _add_column_once(
        "cloud_target_enrollments",
        sa.Column("sandbox_profile_id", sa.Uuid(), nullable=True),
    )
    _add_column_once(
        "cloud_target_enrollments",
        sa.Column("cloud_sandbox_id", sa.Uuid(), nullable=True),
    )
    _add_column_once(
        "cloud_target_enrollments",
        sa.Column("slot_generation", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "cloud_target_enrollments_sandbox_profile_id_fkey",
        "cloud_target_enrollments",
        "sandbox_profile",
        ["sandbox_profile_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "cloud_target_enrollments_cloud_sandbox_id_fkey",
        "cloud_target_enrollments",
        "cloud_sandbox",
        ["cloud_sandbox_id"],
        ["id"],
        ondelete="SET NULL",
    )
    _create_index_once(
        "ix_cloud_target_enrollments_sandbox_profile_id",
        "cloud_target_enrollments",
        ["sandbox_profile_id"],
    )
    _create_index_once(
        "ix_cloud_target_enrollments_cloud_sandbox_id",
        "cloud_target_enrollments",
        ["cloud_sandbox_id"],
    )


def _upgrade_cloud_sandbox() -> None:
    if _has_column("cloud_sandbox", "external_sandbox_id"):
        op.alter_column("cloud_sandbox", "external_sandbox_id", nullable=True)
    _add_column_once("cloud_sandbox", sa.Column("sandbox_profile_id", sa.Uuid(), nullable=True))
    _add_column_once("cloud_sandbox", sa.Column("target_id", sa.Uuid(), nullable=True))
    _add_column_once("cloud_sandbox", sa.Column("billing_subject_id", sa.Uuid(), nullable=True))
    _add_column_once("cloud_sandbox", sa.Column("slot_generation", sa.Integer(), nullable=True))
    _add_column_once(
        "cloud_sandbox", sa.Column("superseded_by_sandbox_id", sa.Uuid(), nullable=True)
    )
    _add_column_once(
        "cloud_sandbox", sa.Column("superseded_at", sa.DateTime(timezone=True), nullable=True)
    )
    _add_column_once(
        "cloud_sandbox",
        sa.Column("lifecycle_on_timeout", sa.String(length=32), nullable=True),
    )
    _add_column_once(
        "cloud_sandbox", sa.Column("lifecycle_auto_resume", sa.Boolean(), nullable=True)
    )
    _add_column_once(
        "cloud_sandbox", sa.Column("provider_timeout_seconds", sa.Integer(), nullable=True)
    )
    _add_column_once("cloud_sandbox", sa.Column("blocked_reason", sa.Text(), nullable=True))
    op.execute(
        "UPDATE cloud_sandbox SET lifecycle_on_timeout = 'pause' "
        "WHERE lifecycle_on_timeout IS NULL"
    )
    op.execute(
        "UPDATE cloud_sandbox SET lifecycle_auto_resume = true WHERE lifecycle_auto_resume IS NULL"
    )
    op.alter_column("cloud_sandbox", "lifecycle_on_timeout", nullable=False)
    op.alter_column("cloud_sandbox", "lifecycle_auto_resume", nullable=False)
    for name, remote, column, ondelete in (
        (
            "cloud_sandbox_sandbox_profile_id_fkey",
            "sandbox_profile",
            "sandbox_profile_id",
            "CASCADE",
        ),
        ("cloud_sandbox_target_id_fkey", "cloud_targets", "target_id", "CASCADE"),
        (
            "cloud_sandbox_billing_subject_id_fkey",
            "billing_subject",
            "billing_subject_id",
            "RESTRICT",
        ),
        (
            "cloud_sandbox_superseded_by_sandbox_id_fkey",
            "cloud_sandbox",
            "superseded_by_sandbox_id",
            "SET NULL",
        ),
    ):
        op.create_foreign_key(name, "cloud_sandbox", remote, [column], ["id"], ondelete=ondelete)
    op.create_check_constraint(
        "ck_cloud_sandbox_lifecycle_on_timeout",
        "cloud_sandbox",
        "lifecycle_on_timeout IN ('pause', 'kill')",
    )
    op.create_check_constraint(
        "ck_cloud_sandbox_managed_slot_identity",
        "cloud_sandbox",
        "(sandbox_profile_id IS NULL AND target_id IS NULL AND slot_generation IS NULL) OR "
        "(sandbox_profile_id IS NOT NULL AND target_id IS NOT NULL "
        "AND billing_subject_id IS NOT NULL AND slot_generation IS NOT NULL)",
    )
    for index_name, columns in (
        ("ix_cloud_sandbox_sandbox_profile_id", ["sandbox_profile_id"]),
        ("ix_cloud_sandbox_target_id", ["target_id"]),
        ("ix_cloud_sandbox_billing_subject_id", ["billing_subject_id"]),
        ("ix_cloud_sandbox_superseded_by_sandbox_id", ["superseded_by_sandbox_id"]),
    ):
        _create_index_once(index_name, "cloud_sandbox", columns)
    op.create_index(
        "ux_cloud_sandbox_active_slot_per_profile_target",
        "cloud_sandbox",
        ["sandbox_profile_id", "target_id"],
        unique=True,
        postgresql_where=sa.text(
            "superseded_at IS NULL AND status IN ('creating','running','paused','blocked')"
        ),
    )


def _create_cloud_target_runtime_access() -> None:
    if _has_table("cloud_target_runtime_access"):
        return
    op.create_table(
        "cloud_target_runtime_access",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("sandbox_profile_id", sa.Uuid(), nullable=False),
        sa.Column("active_sandbox_id", sa.Uuid(), nullable=True),
        sa.Column("slot_generation", sa.Integer(), nullable=True),
        sa.Column("anyharness_base_url", sa.Text(), nullable=True),
        sa.Column("runtime_token_ciphertext", sa.Text(), nullable=True),
        sa.Column("anyharness_data_key_ciphertext", sa.Text(), nullable=True),
        sa.Column("last_worker_id", sa.Uuid(), nullable=True),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(active_sandbox_id IS NULL AND slot_generation IS NULL) OR "
            "(active_sandbox_id IS NOT NULL AND slot_generation IS NOT NULL)",
            name="ck_cloud_target_runtime_access_active_slot_fields",
        ),
        sa.ForeignKeyConstraint(["active_sandbox_id"], ["cloud_sandbox.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["last_worker_id"], ["cloud_workers.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["sandbox_profile_id"], ["sandbox_profile.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("target_id", name="uq_cloud_target_runtime_access_target_id"),
    )
    for index_name, columns in (
        ("ix_cloud_target_runtime_access_sandbox_profile_id", ["sandbox_profile_id"]),
        ("ix_cloud_target_runtime_access_active_sandbox_id", ["active_sandbox_id"]),
        ("ix_cloud_target_runtime_access_last_worker_id", ["last_worker_id"]),
    ):
        _create_index_once(index_name, "cloud_target_runtime_access", columns)


def _replace_profile_target_state() -> None:
    if not _has_table("sandbox_profile_target_state"):
        op.create_table(
            "sandbox_profile_target_state",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("sandbox_profile_id", sa.Uuid(), nullable=False),
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("active_sandbox_id", sa.Uuid(), nullable=True),
            sa.Column("slot_generation", sa.Integer(), nullable=True),
            sa.Column("desired_agent_auth_revision", sa.Integer(), nullable=False),
            sa.Column("applied_agent_auth_revision", sa.Integer(), nullable=True),
            sa.Column("agent_auth_status", sa.String(length=32), nullable=False),
            sa.Column("agent_auth_force_restart_required", sa.Boolean(), nullable=False),
            sa.Column("last_agent_auth_command_id", sa.Uuid(), nullable=True),
            sa.Column("last_agent_auth_worker_id", sa.Uuid(), nullable=True),
            sa.Column("last_agent_auth_attempted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_agent_auth_applied_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_agent_auth_error_code", sa.String(length=128), nullable=True),
            sa.Column("last_agent_auth_error_message", sa.Text(), nullable=True),
            sa.Column("applied_runtime_config_sequence", sa.Integer(), nullable=False),
            sa.Column("applied_runtime_config_revision_id", sa.Text(), nullable=True),
            sa.Column("runtime_config_status", sa.String(length=32), nullable=False),
            sa.Column("last_runtime_config_command_id", sa.Uuid(), nullable=True),
            sa.Column("last_runtime_config_worker_id", sa.Uuid(), nullable=True),
            sa.Column(
                "last_runtime_config_attempted_at", sa.DateTime(timezone=True), nullable=True
            ),
            sa.Column("last_runtime_config_applied_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_runtime_config_error_code", sa.String(length=128), nullable=True),
            sa.Column("last_runtime_config_error_message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                _in_constraint("agent_auth_status", _TARGET_STATE_STATUSES),
                name="ck_sandbox_profile_target_state_agent_auth_status",
            ),
            sa.CheckConstraint(
                _in_constraint("runtime_config_status", _TARGET_STATE_STATUSES),
                name="ck_sandbox_profile_target_state_runtime_config_status",
            ),
            sa.CheckConstraint(
                "applied_agent_auth_revision IS NULL "
                "OR applied_agent_auth_revision <= desired_agent_auth_revision",
                name="ck_sandbox_profile_target_state_agent_auth_applied_lte_desired",
            ),
            sa.CheckConstraint(
                "(active_sandbox_id IS NULL AND slot_generation IS NULL) OR "
                "(active_sandbox_id IS NOT NULL AND slot_generation IS NOT NULL)",
                name="ck_sandbox_profile_target_state_slot_identity",
            ),
            sa.ForeignKeyConstraint(
                ["active_sandbox_id"], ["cloud_sandbox.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(
                ["last_agent_auth_command_id"], ["cloud_commands.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(
                ["last_agent_auth_worker_id"], ["cloud_workers.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(
                ["last_runtime_config_command_id"], ["cloud_commands.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(
                ["last_runtime_config_worker_id"], ["cloud_workers.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(
                ["sandbox_profile_id"], ["sandbox_profile.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    if _has_table("sandbox_profile_agent_auth_target_state"):
        op.execute(
            """
            INSERT INTO sandbox_profile_target_state (
                id, sandbox_profile_id, target_id,
                desired_agent_auth_revision, applied_agent_auth_revision,
                agent_auth_status, agent_auth_force_restart_required,
                last_agent_auth_command_id, last_agent_auth_worker_id,
                last_agent_auth_attempted_at, last_agent_auth_applied_at,
                last_agent_auth_error_code, last_agent_auth_error_message,
                applied_runtime_config_sequence, applied_runtime_config_revision_id,
                runtime_config_status, created_at, updated_at
            )
            SELECT
                id, sandbox_profile_id, target_id,
                desired_revision, applied_revision,
                status, force_restart_required,
                last_command_id, last_worker_id,
                last_attempted_at, last_applied_at,
                last_error_code, last_error_message,
                0, NULL, 'applied', created_at, updated_at
            FROM sandbox_profile_agent_auth_target_state
            ON CONFLICT DO NOTHING
            """
        )
        op.drop_table("sandbox_profile_agent_auth_target_state")
    _create_index_once(
        "uq_sandbox_profile_target_state_target_profile",
        "sandbox_profile_target_state",
        ["target_id", "sandbox_profile_id"],
        unique=True,
    )
    _create_index_once(
        "ix_sandbox_profile_target_state_agent_auth_status_revision",
        "sandbox_profile_target_state",
        [
            "target_id",
            "agent_auth_status",
            "desired_agent_auth_revision",
            "applied_agent_auth_revision",
        ],
    )
    _create_index_once(
        "ix_sandbox_profile_target_state_runtime_config_status",
        "sandbox_profile_target_state",
        ["target_id", "runtime_config_status", "applied_runtime_config_sequence"],
    )


def _upgrade_cloud_workspace() -> None:
    for column in (
        sa.Column("sandbox_profile_id", sa.Uuid(), nullable=True),
        sa.Column("target_id", sa.Uuid(), nullable=True),
        sa.Column("normalized_repo_key", sa.Text(), nullable=True),
        sa.Column("worktree_path", sa.Text(), nullable=True),
        sa.Column("materialized_slot_generation", sa.Integer(), nullable=True),
        sa.Column("required_runtime_config_sequence", sa.Integer(), nullable=True),
        sa.Column("required_runtime_config_revision_id", sa.Text(), nullable=True),
        sa.Column("required_agent_auth_revision", sa.Integer(), nullable=True),
    ):
        _add_column_once("cloud_workspace", column)
    op.execute(
        """
        UPDATE cloud_workspace
        SET normalized_repo_key = LOWER(BTRIM(git_provider)) || '/' ||
                                  LOWER(BTRIM(git_owner)) || '/' ||
                                  LOWER(BTRIM(git_repo_name))
        WHERE normalized_repo_key IS NULL
        """
    )
    op.create_foreign_key(
        "cloud_workspace_sandbox_profile_id_fkey",
        "cloud_workspace",
        "sandbox_profile",
        ["sandbox_profile_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "cloud_workspace_target_id_fkey",
        "cloud_workspace",
        "cloud_targets",
        ["target_id"],
        ["id"],
        ondelete="CASCADE",
    )
    _create_index_once(
        "ix_cloud_workspace_sandbox_profile_id", "cloud_workspace", ["sandbox_profile_id"]
    )
    _create_index_once("ix_cloud_workspace_target_id", "cloud_workspace", ["target_id"])
    op.create_index(
        "ux_cloud_workspace_active_per_branch",
        "cloud_workspace",
        ["sandbox_profile_id", "target_id", "normalized_repo_key", "git_branch"],
        unique=True,
        postgresql_where=sa.text("archived_at IS NULL AND sandbox_profile_id IS NOT NULL"),
    )
    op.create_index(
        "ux_cloud_workspace_active_worktree_path",
        "cloud_workspace",
        ["target_id", "worktree_path"],
        unique=True,
        postgresql_where=sa.text("archived_at IS NULL AND worktree_path IS NOT NULL"),
    )


def _upgrade_cloud_commands() -> None:
    for column in (
        sa.Column("cloud_workspace_id", sa.Uuid(), nullable=True),
        sa.Column("leased_cloud_sandbox_id", sa.Uuid(), nullable=True),
        sa.Column("leased_slot_generation", sa.Integer(), nullable=True),
    ):
        _add_column_once("cloud_commands", column)
    op.create_foreign_key(
        "cloud_commands_cloud_workspace_id_fkey",
        "cloud_commands",
        "cloud_workspace",
        ["cloud_workspace_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "cloud_commands_leased_cloud_sandbox_id_fkey",
        "cloud_commands",
        "cloud_sandbox",
        ["leased_cloud_sandbox_id"],
        ["id"],
        ondelete="SET NULL",
    )
    _create_index_once(
        "ix_cloud_commands_cloud_workspace_id", "cloud_commands", ["cloud_workspace_id"]
    )
    _create_index_once(
        "ix_cloud_commands_leased_cloud_sandbox_id",
        "cloud_commands",
        ["leased_cloud_sandbox_id"],
    )
