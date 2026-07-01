"""repo workspace sandbox model cleanup

Revision ID: d4e6f8a0b2c4
Revises: d4e7f8a9b2c3
Create Date: 2026-06-29 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d4e6f8a0b2c4"
down_revision: str | Sequence[str] | None = "d4e7f8a9b2c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {column["name"] for column in _inspector().get_columns(table_name)}


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return index_name in {index["name"] for index in _inspector().get_indexes(table_name)}


def _has_constraint(table_name: str, constraint_name: str) -> bool:
    if not _has_table(table_name):
        return False
    inspector = _inspector()
    checks = inspector.get_check_constraints(table_name)
    uniques = inspector.get_unique_constraints(table_name)
    foreign_keys = inspector.get_foreign_keys(table_name)
    return constraint_name in {
        *(constraint["name"] for constraint in checks),
        *(constraint["name"] for constraint in uniques),
        *(constraint["name"] for constraint in foreign_keys),
    }


def _add_column_once(table_name: str, column: sa.Column[object]) -> None:
    if not _has_column(table_name, column.name):
        op.add_column(table_name, column)


def _drop_column_once(table_name: str, column_name: str) -> None:
    if _has_column(table_name, column_name):
        op.drop_column(table_name, column_name)


def _create_index_once(
    index_name: str,
    table_name: str,
    columns: list[str],
    *,
    unique: bool = False,
    postgresql_where: sa.TextClause | None = None,
) -> None:
    if not _has_index(table_name, index_name):
        op.create_index(
            index_name,
            table_name,
            columns,
            unique=unique,
            postgresql_where=postgresql_where,
        )


def _drop_index_once(index_name: str, table_name: str) -> None:
    if _has_index(table_name, index_name):
        op.drop_index(index_name, table_name=table_name)


def _drop_constraint_once(
    constraint_name: str,
    table_name: str,
    *,
    type_: str,
) -> None:
    if _has_constraint(table_name, constraint_name):
        op.drop_constraint(constraint_name, table_name, type_=type_)


def _alter_nullable(table_name: str, column_name: str, *, nullable: bool) -> None:
    if _has_column(table_name, column_name):
        op.alter_column(table_name, column_name, nullable=nullable)


def _column_expr(table_name: str, candidates: tuple[str, ...], default: str) -> str:
    for column_name in candidates:
        if _has_column(table_name, column_name):
            return column_name
    return default


def _create_repo_config_tables() -> None:
    if not _has_table("repo_config"):
        op.create_table(
            "repo_config",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("git_provider", sa.String(length=32), nullable=False),
            sa.Column("git_owner", sa.String(length=255), nullable=False),
            sa.Column("git_repo_name", sa.String(length=255), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(
                "git_provider IN ('github')",
                name="ck_repo_config_git_provider",
            ),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_repo_config_user_id", "repo_config", ["user_id"])
    _create_index_once(
        "ux_repo_config_user_repo",
        "repo_config",
        ["user_id", "git_provider", "git_owner", "git_repo_name"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    if not _has_table("repo_environment"):
        op.create_table(
            "repo_environment",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("repo_config_id", sa.Uuid(), nullable=False),
            sa.Column("environment_kind", sa.String(length=32), nullable=False),
            sa.Column("desktop_install_id", sa.String(length=255), nullable=True),
            sa.Column("local_path", sa.Text(), nullable=True),
            sa.Column("default_branch", sa.String(length=255), nullable=True),
            sa.Column("setup_script", sa.Text(), nullable=False, server_default=""),
            sa.Column("run_command", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(
                "environment_kind IN ('local', 'cloud')",
                name="ck_repo_environment_kind",
            ),
            sa.CheckConstraint(
                "((environment_kind = 'local' AND desktop_install_id IS NOT NULL "
                "AND local_path IS NOT NULL) OR "
                "(environment_kind = 'cloud' AND local_path IS NULL))",
                name="ck_repo_environment_kind_fields",
            ),
            sa.ForeignKeyConstraint(["repo_config_id"], ["repo_config.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once(
        "ix_repo_environment_repo_config_id",
        "repo_environment",
        ["repo_config_id"],
    )
    _create_index_once(
        "ix_repo_environment_environment_kind",
        "repo_environment",
        ["environment_kind"],
    )
    _create_index_once(
        "ux_repo_environment_cloud",
        "repo_environment",
        ["repo_config_id"],
        unique=True,
        postgresql_where=sa.text("environment_kind = 'cloud' AND deleted_at IS NULL"),
    )
    _create_index_once(
        "ux_repo_environment_local_path",
        "repo_environment",
        ["repo_config_id", "desktop_install_id", "local_path"],
        unique=True,
        postgresql_where=sa.text("environment_kind = 'local' AND deleted_at IS NULL"),
    )
    if _has_column("repo_config", "owner_scope"):
        op.execute(
            """
            DELETE FROM repo_environment
            WHERE repo_config_id IN (
              SELECT id
              FROM repo_config
              WHERE owner_scope != 'personal'
                 OR user_id IS NULL
            )
            """
        )
        op.execute(
            """
            DELETE FROM repo_config
            WHERE owner_scope != 'personal'
               OR user_id IS NULL
            """
        )
    else:
        op.execute(
            """
            DELETE FROM repo_environment
            WHERE repo_config_id IN (
              SELECT id
              FROM repo_config
              WHERE user_id IS NULL
            )
            """
        )
        op.execute("DELETE FROM repo_config WHERE user_id IS NULL")
    _drop_index_once("ix_repo_config_organization_id", "repo_config")
    _drop_index_once("ux_repo_config_personal_repo", "repo_config")
    _drop_index_once("ux_repo_config_organization_repo", "repo_config")
    _drop_constraint_once("ck_repo_config_owner_scope", "repo_config", type_="check")
    _drop_constraint_once("ck_repo_config_owner_fields", "repo_config", type_="check")
    _drop_constraint_once("repo_config_organization_id_fkey", "repo_config", type_="foreignkey")
    _drop_column_once("repo_config", "owner_scope")
    _drop_column_once("repo_config", "organization_id")
    _alter_nullable("repo_config", "user_id", nullable=False)
    _create_index_once(
        "ux_repo_config_user_repo",
        "repo_config",
        ["user_id", "git_provider", "git_owner", "git_repo_name"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    _drop_column_once("repo_environment", "configured")
    _drop_column_once("repo_environment", "configured_at")
    _drop_column_once("repo_environment", "setup_script_version")
    _drop_column_once("repo_environment", "config_version")


def _backfill_repo_config_tables() -> None:
    if not _has_table("cloud_repo_config"):
        return
    op.execute(
        """
        INSERT INTO repo_config (
          id,
          user_id,
          git_provider,
          git_owner,
          git_repo_name,
          created_at,
          updated_at,
          deleted_at
        )
        SELECT
          old.id,
          old.user_id,
          'github',
          old.git_owner,
          old.git_repo_name,
          old.created_at,
          old.updated_at,
          NULL
        FROM cloud_repo_config AS old
        WHERE old.owner_scope = 'personal'
          AND old.user_id IS NOT NULL
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO repo_environment (
          id,
          repo_config_id,
          environment_kind,
          desktop_install_id,
          local_path,
          default_branch,
          setup_script,
          run_command,
          created_at,
          updated_at,
          deleted_at
        )
        SELECT
          old.id,
          old.id,
          'cloud',
          NULL,
          NULL,
          old.default_branch,
          COALESCE(old.setup_script, ''),
          COALESCE(old.run_command, ''),
          old.created_at,
          old.updated_at,
          NULL
        FROM cloud_repo_config AS old
        JOIN repo_config AS repo ON repo.id = old.id
        WHERE repo.id = old.id
        ON CONFLICT DO NOTHING
        """
    )


def _drop_cloud_sandbox_analytics_views() -> None:
    op.execute("DROP VIEW IF EXISTS analytics.daily_sandboxes")


def _create_cloud_sandbox_analytics_views() -> None:
    op.execute(
        """
        CREATE OR REPLACE VIEW analytics.daily_sandboxes AS
        SELECT
            (created_at AT TIME ZONE 'UTC')::date AS activity_date,
            sandbox_type AS provider,
            status,
            count(*) FILTER (WHERE provider_sandbox_id IS NOT NULL) AS provisioned_sandboxes,
            count(*) AS sandbox_records
        FROM cloud_sandbox
        GROUP BY (created_at AT TIME ZONE 'UTC')::date, sandbox_type, status
        """
    )


def _drop_cloud_workspace_analytics_views() -> None:
    op.execute("DROP VIEW IF EXISTS analytics.daily_cloud_workspaces")


def _create_cloud_workspace_analytics_views() -> None:
    op.execute(
        """
        CREATE OR REPLACE VIEW analytics.daily_cloud_workspaces AS
        SELECT
            activity_date,
            owner_scope,
            sum(new_cloud_workspaces)::bigint AS new_cloud_workspaces,
            sum(archived_cloud_workspaces)::bigint AS archived_cloud_workspaces
        FROM (
            SELECT
                (created_at AT TIME ZONE 'UTC')::date AS activity_date,
                'personal'::text AS owner_scope,
                count(*) AS new_cloud_workspaces,
                0::bigint AS archived_cloud_workspaces
            FROM cloud_workspace
            GROUP BY (created_at AT TIME ZONE 'UTC')::date
            UNION ALL
            SELECT
                (archived_at AT TIME ZONE 'UTC')::date AS activity_date,
                'personal'::text AS owner_scope,
                0::bigint AS new_cloud_workspaces,
                count(*) AS archived_cloud_workspaces
            FROM cloud_workspace
            WHERE archived_at IS NOT NULL
            GROUP BY (archived_at AT TIME ZONE 'UTC')::date
        ) daily
        GROUP BY activity_date, owner_scope
        """
    )


def _drop_legacy_cloud_analytics_views() -> None:
    op.execute("DROP VIEW IF EXISTS analytics.daily_cloud_sessions")


def _drop_legacy_repo_config_links() -> None:
    _drop_constraint_once(
        "repo_config_legacy_cloud_repo_config_id_fkey",
        "repo_config",
        type_="foreignkey",
    )
    _drop_constraint_once(
        "uq_repo_config_legacy_cloud_repo_config_id",
        "repo_config",
        type_="unique",
    )
    _drop_column_once("repo_config", "legacy_cloud_repo_config_id")

    _drop_constraint_once(
        "repo_environment_legacy_cloud_repo_config_id_fkey",
        "repo_environment",
        type_="foreignkey",
    )
    _drop_constraint_once(
        "uq_repo_environment_legacy_cloud_repo_config_id",
        "repo_environment",
        type_="unique",
    )
    _drop_column_once("repo_environment", "legacy_cloud_repo_config_id")


def _upgrade_cloud_sandbox() -> None:
    if not _has_table("cloud_sandbox"):
        return
    _add_column_once(
        "cloud_sandbox",
        sa.Column("sandbox_type", sa.String(length=32), nullable=False, server_default="e2b"),
    )
    _add_column_once(
        "cloud_sandbox",
        sa.Column("provider_sandbox_id", sa.String(length=255), nullable=True),
    )
    _add_column_once(
        "cloud_sandbox",
        sa.Column("owner_user_id", sa.Uuid(), nullable=True),
    )
    _add_column_once(
        "cloud_sandbox",
        sa.Column("anyharness_base_url", sa.Text(), nullable=True),
    )
    _add_column_once(
        "cloud_sandbox",
        sa.Column("runtime_token_ciphertext", sa.Text(), nullable=True),
    )
    _add_column_once(
        "cloud_sandbox",
        sa.Column("anyharness_data_key_ciphertext", sa.Text(), nullable=True),
    )
    _add_column_once(
        "cloud_sandbox",
        sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True),
    )
    _add_column_once(
        "cloud_sandbox",
        sa.Column("last_health_at", sa.DateTime(timezone=True), nullable=True),
    )
    _add_column_once(
        "cloud_sandbox",
        sa.Column("destroyed_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Existing profile DBs may already have the older cloud_sandbox table shape
    # with NOT NULL columns that are not part of the simplified model. The
    # backfill below intentionally writes only the new columns, and these old
    # columns are dropped after data has been migrated.
    for legacy_column in (
        "sandbox_profile_id",
        "target_id",
        "billing_subject_id",
        "provider",
        "external_sandbox_id",
        "template_version",
        "last_provider_event_at",
        "last_provider_event_kind",
        "started_at",
        "stopped_at",
        "last_heartbeat_at",
        "lifecycle_on_timeout",
        "lifecycle_auto_resume",
        "provider_timeout_seconds",
        "blocked_reason",
        "last_error",
    ):
        _alter_nullable("cloud_sandbox", legacy_column, nullable=True)
    if _has_table("managed_sandbox") and _has_column("managed_sandbox", "owner_user_id"):
        provider_expr = _column_expr(
            "managed_sandbox",
            ("sandbox_type", "provider"),
            "'e2b'",
        )
        external_sandbox_expr = _column_expr(
            "managed_sandbox",
            ("provider_sandbox_id", "e2b_sandbox_id"),
            "NULL",
        )
        runtime_token_expr = _column_expr(
            "managed_sandbox",
            ("runtime_token_ciphertext", "anyharness_bearer_token_ciphertext"),
            "NULL",
        )
        anyharness_base_expr = _column_expr(
            "managed_sandbox",
            ("anyharness_base_url",),
            "NULL",
        )
        data_key_expr = _column_expr(
            "managed_sandbox",
            ("anyharness_data_key_ciphertext",),
            "NULL",
        )
        ready_at_expr = _column_expr("managed_sandbox", ("ready_at",), "NULL")
        last_health_expr = _column_expr("managed_sandbox", ("last_health_at",), "NULL")
        destroyed_at_expr = _column_expr("managed_sandbox", ("destroyed_at",), "NULL")
        created_at_expr = _column_expr("managed_sandbox", ("created_at",), "now()")
        updated_at_expr = _column_expr("managed_sandbox", ("updated_at",), "now()")
        owner_scope_filter = (
            "AND owner_scope = 'personal'" if _has_column("managed_sandbox", "owner_scope") else ""
        )
        op.execute(
            f"""
            INSERT INTO cloud_sandbox (
              id,
              owner_user_id,
              sandbox_type,
              provider_sandbox_id,
              status,
              anyharness_base_url,
              runtime_token_ciphertext,
              anyharness_data_key_ciphertext,
              ready_at,
              last_health_at,
              destroyed_at,
              created_at,
              updated_at
            )
            SELECT
              id,
              owner_user_id,
              COALESCE({provider_expr}, 'e2b'),
              {external_sandbox_expr},
              CASE status
                WHEN 'starting' THEN 'creating'
                WHEN 'provisioning' THEN 'creating'
                WHEN 'running' THEN 'ready'
                WHEN 'blocked' THEN 'error'
                WHEN 'destroying' THEN 'destroyed'
                ELSE status
              END,
              {anyharness_base_expr},
              {runtime_token_expr},
              {data_key_expr},
              {ready_at_expr},
              {last_health_expr},
              {destroyed_at_expr},
              {created_at_expr},
              {updated_at_expr}
            FROM managed_sandbox
            WHERE owner_user_id IS NOT NULL
            {owner_scope_filter}
            ON CONFLICT (id) DO UPDATE SET
              owner_user_id = EXCLUDED.owner_user_id,
              sandbox_type = EXCLUDED.sandbox_type,
              provider_sandbox_id = COALESCE(
                cloud_sandbox.provider_sandbox_id,
                EXCLUDED.provider_sandbox_id
              ),
              status = EXCLUDED.status,
              anyharness_base_url = EXCLUDED.anyharness_base_url,
              runtime_token_ciphertext = EXCLUDED.runtime_token_ciphertext,
              anyharness_data_key_ciphertext = EXCLUDED.anyharness_data_key_ciphertext,
              ready_at = EXCLUDED.ready_at,
              last_health_at = EXCLUDED.last_health_at,
              destroyed_at = EXCLUDED.destroyed_at,
              updated_at = EXCLUDED.updated_at
            """
        )
    if _has_column("cloud_sandbox", "external_sandbox_id"):
        op.execute(
            """
            UPDATE cloud_sandbox
            SET provider_sandbox_id = external_sandbox_id
            WHERE provider_sandbox_id IS NULL
              AND external_sandbox_id IS NOT NULL
            """
        )
    if _has_column("cloud_sandbox", "provider"):
        op.execute(
            """
            UPDATE cloud_sandbox
            SET sandbox_type = CASE WHEN provider = 'e2b' THEN 'e2b' ELSE 'e2b' END
            WHERE provider IS NOT NULL
            """
        )
    if _has_column("cloud_sandbox", "status"):
        op.execute(
            """
            UPDATE cloud_sandbox
            SET status = CASE status
              WHEN 'starting' THEN 'creating'
              WHEN 'provisioning' THEN 'creating'
              WHEN 'running' THEN 'ready'
              WHEN 'stopped' THEN 'paused'
              WHEN 'blocked' THEN 'error'
              WHEN 'destroying' THEN 'destroyed'
              ELSE status
            END
            WHERE status IN (
              'starting',
              'provisioning',
              'running',
              'stopped',
              'blocked',
              'destroying'
            )
            """
        )
    if _has_table("sandbox_profile") and _has_column("cloud_sandbox", "sandbox_profile_id"):
        op.execute(
            """
            UPDATE cloud_sandbox AS sandbox
            SET owner_user_id = profile.owner_user_id
            FROM sandbox_profile AS profile
            WHERE sandbox.owner_user_id IS NULL
              AND sandbox.sandbox_profile_id = profile.id
              AND profile.owner_scope = 'personal'
              AND profile.owner_user_id IS NOT NULL
            """
        )
    if _has_table("cloud_targets") and _has_column("cloud_sandbox", "target_id"):
        op.execute(
            """
            UPDATE cloud_sandbox AS sandbox
            SET owner_user_id = target.owner_user_id
            FROM cloud_targets AS target
            WHERE sandbox.owner_user_id IS NULL
              AND sandbox.target_id = target.id
              AND target.owner_scope = 'personal'
              AND target.owner_user_id IS NOT NULL
            """
        )
    if _has_column("cloud_workspace", "active_sandbox_id"):
        op.execute(
            """
            UPDATE cloud_sandbox AS sandbox
            SET owner_user_id = COALESCE(workspace.owner_user_id, workspace.user_id)
            FROM cloud_workspace AS workspace
            WHERE sandbox.owner_user_id IS NULL
              AND workspace.active_sandbox_id = sandbox.id
              AND COALESCE(workspace.owner_user_id, workspace.user_id) IS NOT NULL
            """
        )
    op.execute(
        """
        DELETE FROM cloud_sandbox
        WHERE owner_user_id IS NULL
        """
    )
    op.execute(
        """
        WITH ranked AS (
          SELECT
            id,
            row_number() OVER (
              PARTITION BY owner_user_id
              ORDER BY updated_at DESC, created_at DESC, id DESC
            ) AS rank
          FROM cloud_sandbox
          WHERE owner_user_id IS NOT NULL
            AND destroyed_at IS NULL
        )
        UPDATE cloud_sandbox
        SET
          status = 'destroyed',
          destroyed_at = COALESCE(destroyed_at, updated_at, now()),
          updated_at = now()
        WHERE id IN (SELECT id FROM ranked WHERE rank > 1)
        """
    )
    op.execute(
        """
        WITH ranked AS (
          SELECT
            id,
            row_number() OVER (
              PARTITION BY provider_sandbox_id
              ORDER BY updated_at DESC, created_at DESC, id DESC
            ) AS rank
          FROM cloud_sandbox
          WHERE provider_sandbox_id IS NOT NULL
        )
        UPDATE cloud_sandbox
        SET provider_sandbox_id = NULL
        WHERE id IN (SELECT id FROM ranked WHERE rank > 1)
        """
    )
    _drop_constraint_once("ck_cloud_sandbox_status", "cloud_sandbox", type_="check")
    if not _has_constraint("cloud_sandbox", "ck_cloud_sandbox_status"):
        op.create_check_constraint(
            "ck_cloud_sandbox_status",
            "cloud_sandbox",
            "status IN ('creating', 'ready', 'paused', 'error', 'destroyed')",
        )
    if not _has_constraint("cloud_sandbox", "ck_cloud_sandbox_type"):
        op.create_check_constraint(
            "ck_cloud_sandbox_type",
            "cloud_sandbox",
            "sandbox_type IN ('e2b')",
        )
    if not _has_constraint("cloud_sandbox", "cloud_sandbox_owner_user_id_fkey"):
        op.create_foreign_key(
            "cloud_sandbox_owner_user_id_fkey",
            "cloud_sandbox",
            "user",
            ["owner_user_id"],
            ["id"],
            ondelete="CASCADE",
        )
    _alter_nullable("cloud_sandbox", "owner_user_id", nullable=False)
    _create_index_once(
        "ix_cloud_sandbox_owner_user_status",
        "cloud_sandbox",
        ["owner_user_id", "status"],
    )
    _create_index_once(
        "ux_cloud_sandbox_personal_active",
        "cloud_sandbox",
        ["owner_user_id"],
        unique=True,
        postgresql_where=sa.text("destroyed_at IS NULL"),
    )
    _create_index_once(
        "ux_cloud_sandbox_provider_sandbox_id",
        "cloud_sandbox",
        ["provider_sandbox_id"],
        unique=True,
        postgresql_where=sa.text("provider_sandbox_id IS NOT NULL"),
    )
    _drop_index_once("ux_cloud_sandbox_active_slot_per_profile_target", "cloud_sandbox")
    _drop_index_once("ux_cloud_sandbox_active_per_target", "cloud_sandbox")
    _drop_index_once("ix_cloud_sandbox_sandbox_profile_id", "cloud_sandbox")
    _drop_index_once("ix_cloud_sandbox_target_id", "cloud_sandbox")
    _drop_index_once("ix_cloud_sandbox_billing_subject_id", "cloud_sandbox")
    _drop_constraint_once(
        "ck_cloud_sandbox_managed_target_identity",
        "cloud_sandbox",
        type_="check",
    )
    _drop_constraint_once(
        "ck_cloud_sandbox_managed_slot_identity",
        "cloud_sandbox",
        type_="check",
    )
    _drop_constraint_once(
        "cloud_sandbox_sandbox_profile_id_fkey",
        "cloud_sandbox",
        type_="foreignkey",
    )
    _drop_constraint_once(
        "cloud_sandbox_target_id_fkey",
        "cloud_sandbox",
        type_="foreignkey",
    )
    _drop_constraint_once(
        "cloud_sandbox_billing_subject_id_fkey",
        "cloud_sandbox",
        type_="foreignkey",
    )
    _drop_column_once("cloud_sandbox", "sandbox_profile_id")
    _drop_column_once("cloud_sandbox", "target_id")
    _drop_column_once("cloud_sandbox", "billing_subject_id")
    _drop_column_once("cloud_sandbox", "provider")
    _drop_column_once("cloud_sandbox", "external_sandbox_id")
    _drop_column_once("cloud_sandbox", "template_version")
    _drop_column_once("cloud_sandbox", "last_provider_event_at")
    _drop_column_once("cloud_sandbox", "last_provider_event_kind")
    _drop_column_once("cloud_sandbox", "started_at")
    _drop_column_once("cloud_sandbox", "stopped_at")
    _drop_column_once("cloud_sandbox", "last_heartbeat_at")
    _drop_column_once("cloud_sandbox", "lifecycle_on_timeout")
    _drop_column_once("cloud_sandbox", "lifecycle_auto_resume")
    _drop_column_once("cloud_sandbox", "provider_timeout_seconds")
    _drop_column_once("cloud_sandbox", "blocked_reason")
    _drop_column_once("cloud_sandbox", "last_error")


def _upgrade_agent_auth_tables() -> None:
    if _has_table("sandbox_agent_auth_selection"):
        _add_column_once(
            "sandbox_agent_auth_selection",
            sa.Column("owner_user_id", sa.Uuid(), nullable=True),
        )
        _add_column_once(
            "sandbox_agent_auth_selection",
            sa.Column("organization_id", sa.Uuid(), nullable=True),
        )
        if _has_table("sandbox_profile") and _has_column(
            "sandbox_agent_auth_selection",
            "sandbox_profile_id",
        ):
            op.execute(
                """
                UPDATE sandbox_agent_auth_selection AS selection
                SET
                  owner_user_id = profile.owner_user_id,
                  organization_id = profile.organization_id,
                  owner_scope = profile.owner_scope
                FROM sandbox_profile AS profile
                WHERE selection.sandbox_profile_id = profile.id
                """
            )
        _drop_index_once(
            "uq_sandbox_agent_auth_selection_profile_agent_slot",
            "sandbox_agent_auth_selection",
        )
        _drop_constraint_once(
            "sandbox_agent_auth_selection_sandbox_profile_id_fkey",
            "sandbox_agent_auth_selection",
            type_="foreignkey",
        )
        _drop_constraint_once(
            "ck_sandbox_agent_auth_selection_owner_fields",
            "sandbox_agent_auth_selection",
            type_="check",
        )
        _drop_column_once("sandbox_agent_auth_selection", "sandbox_profile_id")
        if not _has_constraint(
            "sandbox_agent_auth_selection",
            "sandbox_agent_auth_selection_owner_user_id_fkey",
        ):
            op.create_foreign_key(
                "sandbox_agent_auth_selection_owner_user_id_fkey",
                "sandbox_agent_auth_selection",
                "user",
                ["owner_user_id"],
                ["id"],
                ondelete="CASCADE",
            )
        if not _has_constraint(
            "sandbox_agent_auth_selection",
            "sandbox_agent_auth_selection_organization_id_fkey",
        ):
            op.create_foreign_key(
                "sandbox_agent_auth_selection_organization_id_fkey",
                "sandbox_agent_auth_selection",
                "organization",
                ["organization_id"],
                ["id"],
                ondelete="CASCADE",
            )
        if not _has_constraint(
            "sandbox_agent_auth_selection",
            "ck_sandbox_agent_auth_selection_owner_fields",
        ):
            op.create_check_constraint(
                "ck_sandbox_agent_auth_selection_owner_fields",
                "sandbox_agent_auth_selection",
                "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
                "AND organization_id IS NULL) OR "
                "(owner_scope = 'organization' AND owner_user_id IS NULL "
                "AND organization_id IS NOT NULL))",
            )
        _create_index_once(
            "uq_sandbox_agent_auth_selection_personal_agent_slot",
            "sandbox_agent_auth_selection",
            ["owner_user_id", "agent_kind", "auth_slot_id"],
            unique=True,
            postgresql_where=sa.text("owner_scope = 'personal'"),
        )
        _create_index_once(
            "uq_sandbox_agent_auth_selection_org_agent_slot",
            "sandbox_agent_auth_selection",
            ["organization_id", "agent_kind", "auth_slot_id"],
            unique=True,
            postgresql_where=sa.text("owner_scope = 'organization'"),
        )

    if _has_table("agent_gateway_runtime_grant"):
        _add_column_once(
            "agent_gateway_runtime_grant",
            sa.Column("cloud_sandbox_id", sa.Uuid(), nullable=True),
        )
        _add_column_once(
            "agent_gateway_runtime_grant",
            sa.Column("issued_selection_revision", sa.Integer(), nullable=True),
        )
        if _has_column("agent_gateway_runtime_grant", "issued_profile_revision"):
            op.execute(
                """
                UPDATE agent_gateway_runtime_grant
                SET issued_selection_revision = issued_profile_revision
                WHERE issued_selection_revision IS NULL
                """
            )
        if _has_column("agent_gateway_runtime_grant", "target_id") and _has_column(
            "cloud_sandbox",
            "target_id",
        ):
            op.execute(
                """
                UPDATE agent_gateway_runtime_grant AS runtime_grant
                SET cloud_sandbox_id = sandbox.id
                FROM cloud_sandbox AS sandbox
                WHERE runtime_grant.cloud_sandbox_id IS NULL
                  AND runtime_grant.target_id = sandbox.target_id
                """
            )
        _drop_index_once(
            "ix_agent_gateway_runtime_grant_target_profile_agent",
            "agent_gateway_runtime_grant",
        )
        _drop_index_once(
            "ix_agent_gateway_runtime_grant_selection_revision",
            "agent_gateway_runtime_grant",
        )
        _drop_constraint_once(
            "agent_gateway_runtime_grant_target_id_fkey",
            "agent_gateway_runtime_grant",
            type_="foreignkey",
        )
        _drop_constraint_once(
            "agent_gateway_runtime_grant_sandbox_profile_id_fkey",
            "agent_gateway_runtime_grant",
            type_="foreignkey",
        )
        _drop_column_once("agent_gateway_runtime_grant", "target_id")
        _drop_column_once("agent_gateway_runtime_grant", "sandbox_profile_id")
        _drop_column_once("agent_gateway_runtime_grant", "issued_profile_revision")
        if not _has_constraint(
            "agent_gateway_runtime_grant",
            "agent_gateway_runtime_grant_cloud_sandbox_id_fkey",
        ):
            op.create_foreign_key(
                "agent_gateway_runtime_grant_cloud_sandbox_id_fkey",
                "agent_gateway_runtime_grant",
                "cloud_sandbox",
                ["cloud_sandbox_id"],
                ["id"],
                ondelete="CASCADE",
            )
        _create_index_once(
            "ix_agent_gateway_runtime_grant_sandbox_agent",
            "agent_gateway_runtime_grant",
            ["cloud_sandbox_id", "agent_kind", "auth_slot_id"],
        )
        _create_index_once(
            "ix_agent_gateway_runtime_grant_selection_revision",
            "agent_gateway_runtime_grant",
            ["selection_id", "issued_selection_revision"],
        )

    if _has_table("agent_gateway_router_materialization"):
        _add_column_once(
            "agent_gateway_router_materialization",
            sa.Column("cloud_sandbox_id", sa.Uuid(), nullable=True),
        )
        if _has_column("agent_gateway_router_materialization", "target_id") and _has_column(
            "cloud_sandbox",
            "target_id",
        ):
            op.execute(
                """
                UPDATE agent_gateway_router_materialization AS materialization
                SET cloud_sandbox_id = sandbox.id
                FROM cloud_sandbox AS sandbox
                WHERE materialization.cloud_sandbox_id IS NULL
                  AND materialization.target_id = sandbox.target_id
                """
            )
        _drop_index_once(
            "uq_agent_gateway_router_materialization_runtime",
            "agent_gateway_router_materialization",
        )
        _drop_constraint_once(
            "agent_gateway_router_materialization_sandbox_profile_id_fkey",
            "agent_gateway_router_materialization",
            type_="foreignkey",
        )
        _drop_constraint_once(
            "agent_gateway_router_materialization_target_id_fkey",
            "agent_gateway_router_materialization",
            type_="foreignkey",
        )
        _drop_column_once("agent_gateway_router_materialization", "sandbox_profile_id")
        _drop_column_once("agent_gateway_router_materialization", "target_id")
        if not _has_constraint(
            "agent_gateway_router_materialization",
            "agent_gateway_router_materialization_cloud_sandbox_id_fkey",
        ):
            op.create_foreign_key(
                "agent_gateway_router_materialization_cloud_sandbox_id_fkey",
                "agent_gateway_router_materialization",
                "cloud_sandbox",
                ["cloud_sandbox_id"],
                ["id"],
                ondelete="CASCADE",
            )
        _create_index_once(
            "uq_agent_gateway_router_materialization_runtime",
            "agent_gateway_router_materialization",
            [
                "router_kind",
                "router_object_kind",
                "object_scope",
                "selection_id",
                "cloud_sandbox_id",
            ],
            unique=True,
            postgresql_where=sa.text("object_scope = 'runtime_selection' AND status != 'revoked'"),
        )

    if _has_table("agent_auth_audit_event"):
        _add_column_once(
            "agent_auth_audit_event",
            sa.Column("cloud_sandbox_id", sa.Uuid(), nullable=True),
        )
        if _has_column("agent_auth_audit_event", "target_id") and _has_column(
            "cloud_sandbox",
            "target_id",
        ):
            op.execute(
                """
                UPDATE agent_auth_audit_event AS audit_event
                SET cloud_sandbox_id = sandbox.id
                FROM cloud_sandbox AS sandbox
                WHERE audit_event.cloud_sandbox_id IS NULL
                  AND audit_event.target_id = sandbox.target_id
                """
            )
        _drop_constraint_once(
            "agent_auth_audit_event_sandbox_profile_id_fkey",
            "agent_auth_audit_event",
            type_="foreignkey",
        )
        _drop_constraint_once(
            "agent_auth_audit_event_target_id_fkey",
            "agent_auth_audit_event",
            type_="foreignkey",
        )
        _drop_column_once("agent_auth_audit_event", "sandbox_profile_id")
        _drop_column_once("agent_auth_audit_event", "target_id")
        if not _has_constraint(
            "agent_auth_audit_event",
            "agent_auth_audit_event_cloud_sandbox_id_fkey",
        ):
            op.create_foreign_key(
                "agent_auth_audit_event_cloud_sandbox_id_fkey",
                "agent_auth_audit_event",
                "cloud_sandbox",
                ["cloud_sandbox_id"],
                ["id"],
                ondelete="SET NULL",
            )


def _upgrade_secret_tables() -> None:
    if _has_table("cloud_secret_set"):
        _drop_index_once("ix_cloud_secret_set_cloud_repo_config_id", "cloud_secret_set")
        _drop_index_once("ux_cloud_secret_set_workspace", "cloud_secret_set")
        _drop_constraint_once(
            "fk_cloud_secret_set_repo_environment_id",
            "cloud_secret_set",
            type_="foreignkey",
        )
        _drop_constraint_once(
            "ck_cloud_secret_set_scope_fields",
            "cloud_secret_set",
            type_="check",
        )
        if not _has_constraint("cloud_secret_set", "fk_cloud_secret_set_repo_environment_id"):
            op.create_foreign_key(
                "fk_cloud_secret_set_repo_environment_id",
                "cloud_secret_set",
                "repo_environment",
                ["repo_environment_id"],
                ["id"],
                ondelete="CASCADE",
            )
        if not _has_constraint("cloud_secret_set", "ck_cloud_secret_set_scope_fields"):
            op.create_check_constraint(
                "ck_cloud_secret_set_scope_fields",
                "cloud_secret_set",
                "((scope_kind = 'personal' AND user_id IS NOT NULL "
                "AND organization_id IS NULL AND repo_environment_id IS NULL) OR "
                "(scope_kind = 'organization' AND organization_id IS NOT NULL "
                "AND user_id IS NULL AND repo_environment_id IS NULL) OR "
                "(scope_kind = 'workspace' AND repo_environment_id IS NOT NULL "
                "AND user_id IS NULL AND organization_id IS NULL))",
            )
        _create_index_once(
            "ux_cloud_secret_set_workspace_environment",
            "cloud_secret_set",
            ["repo_environment_id"],
            unique=True,
            postgresql_where=sa.text("scope_kind = 'workspace'"),
        )
        _drop_column_once("cloud_secret_set", "cloud_repo_config_id")

    if _has_table("managed_sandbox_secret_materialization") and not _has_table(
        "cloud_sandbox_secret_materialization"
    ):
        op.rename_table(
            "managed_sandbox_secret_materialization",
            "cloud_sandbox_secret_materialization",
        )

    if not _has_table("cloud_sandbox_secret_materialization"):
        return

    _drop_index_once(
        "ix_managed_sandbox_secret_materialization_cloud_repo_config_id",
        "cloud_sandbox_secret_materialization",
    )
    _drop_index_once(
        "ix_managed_sandbox_secret_materialization_managed_sandbox_id",
        "cloud_sandbox_secret_materialization",
    )
    _drop_index_once(
        "ix_managed_sandbox_secret_materialization_materialization_kind",
        "cloud_sandbox_secret_materialization",
    )
    _drop_index_once(
        "ix_managed_sandbox_secret_materialization_status",
        "cloud_sandbox_secret_materialization",
    )
    _drop_index_once(
        "ux_managed_sandbox_secret_materialization_global",
        "cloud_sandbox_secret_materialization",
    )
    _drop_index_once(
        "ux_managed_sandbox_secret_materialization_workspace",
        "cloud_sandbox_secret_materialization",
    )
    _drop_index_once(
        "ux_managed_sandbox_secret_materialization_workspace_environment",
        "cloud_sandbox_secret_materialization",
    )
    _drop_constraint_once(
        "managed_sandbox_secret_materialization_managed_sandbox_id_fkey",
        "cloud_sandbox_secret_materialization",
        type_="foreignkey",
    )
    _drop_constraint_once(
        "fk_managed_sandbox_secret_materialization_repo_environment_id",
        "cloud_sandbox_secret_materialization",
        type_="foreignkey",
    )
    _drop_constraint_once(
        "ck_managed_sandbox_secret_materialization_kind",
        "cloud_sandbox_secret_materialization",
        type_="check",
    )
    _drop_constraint_once(
        "ck_managed_sandbox_secret_materialization_status",
        "cloud_sandbox_secret_materialization",
        type_="check",
    )
    _drop_constraint_once(
        "ck_managed_sandbox_secret_materialization_scope",
        "cloud_sandbox_secret_materialization",
        type_="check",
    )
    if _has_column("cloud_sandbox_secret_materialization", "managed_sandbox_id"):
        op.alter_column(
            "cloud_sandbox_secret_materialization",
            "managed_sandbox_id",
            new_column_name="cloud_sandbox_id",
        )
    _drop_column_once("cloud_sandbox_secret_materialization", "cloud_repo_config_id")
    if not _has_constraint(
        "cloud_sandbox_secret_materialization",
        "cloud_sandbox_secret_materialization_cloud_sandbox_id_fkey",
    ):
        op.create_foreign_key(
            "cloud_sandbox_secret_materialization_cloud_sandbox_id_fkey",
            "cloud_sandbox_secret_materialization",
            "cloud_sandbox",
            ["cloud_sandbox_id"],
            ["id"],
            ondelete="CASCADE",
        )
    if not _has_constraint(
        "cloud_sandbox_secret_materialization",
        "cloud_sandbox_secret_materialization_repo_environment_id_fkey",
    ):
        op.create_foreign_key(
            "cloud_sandbox_secret_materialization_repo_environment_id_fkey",
            "cloud_sandbox_secret_materialization",
            "repo_environment",
            ["repo_environment_id"],
            ["id"],
            ondelete="CASCADE",
        )
    if not _has_constraint(
        "cloud_sandbox_secret_materialization",
        "ck_cloud_sandbox_secret_materialization_kind",
    ):
        op.create_check_constraint(
            "ck_cloud_sandbox_secret_materialization_kind",
            "cloud_sandbox_secret_materialization",
            "materialization_kind IN ('global', 'workspace')",
        )
    if not _has_constraint(
        "cloud_sandbox_secret_materialization",
        "ck_cloud_sandbox_secret_materialization_status",
    ):
        op.create_check_constraint(
            "ck_cloud_sandbox_secret_materialization_status",
            "cloud_sandbox_secret_materialization",
            "status IN ('pending', 'running', 'ready', 'error')",
        )
    if not _has_constraint(
        "cloud_sandbox_secret_materialization",
        "ck_cloud_sandbox_secret_materialization_scope",
    ):
        op.create_check_constraint(
            "ck_cloud_sandbox_secret_materialization_scope",
            "cloud_sandbox_secret_materialization",
            "((materialization_kind = 'global' AND repo_environment_id IS NULL) OR "
            "(materialization_kind = 'workspace' AND repo_environment_id IS NOT NULL))",
        )
    _create_index_once(
        "ix_cloud_sandbox_secret_materialization_materialization_kind",
        "cloud_sandbox_secret_materialization",
        ["materialization_kind"],
    )
    _create_index_once(
        "ix_cloud_sandbox_secret_materialization_status",
        "cloud_sandbox_secret_materialization",
        ["cloud_sandbox_id", "status"],
    )
    _create_index_once(
        "ux_cloud_sandbox_secret_materialization_global",
        "cloud_sandbox_secret_materialization",
        ["cloud_sandbox_id"],
        unique=True,
        postgresql_where=sa.text("materialization_kind = 'global'"),
    )
    _create_index_once(
        "ux_cloud_sandbox_secret_materialization_workspace_environment",
        "cloud_sandbox_secret_materialization",
        ["cloud_sandbox_id", "repo_environment_id"],
        unique=True,
        postgresql_where=sa.text("materialization_kind = 'workspace'"),
    )


def _upgrade_slack_tables() -> None:
    if _has_table("slack_bot_config"):
        _add_column_once(
            "slack_bot_config",
            sa.Column("fixed_repo_environment_id", sa.Uuid(), nullable=True),
        )
        _add_column_once(
            "slack_bot_config",
            sa.Column("allowed_repo_environment_ids", sa.Text(), nullable=True),
        )
        if _has_column("slack_bot_config", "fixed_cloud_repo_config_id"):
            op.execute(
                """
                UPDATE slack_bot_config
                SET fixed_repo_environment_id = fixed_cloud_repo_config_id
                WHERE fixed_repo_environment_id IS NULL
                """
            )
        if _has_column("slack_bot_config", "allowed_cloud_repo_config_ids"):
            op.execute(
                """
                UPDATE slack_bot_config
                SET allowed_repo_environment_ids = allowed_cloud_repo_config_ids
                WHERE allowed_repo_environment_ids IS NULL
                """
            )
        _drop_constraint_once(
            "ck_slack_bot_config_fixed_repo_present",
            "slack_bot_config",
            type_="check",
        )
        _drop_constraint_once(
            "slack_bot_config_fixed_cloud_repo_config_id_fkey",
            "slack_bot_config",
            type_="foreignkey",
        )
        _drop_column_once("slack_bot_config", "fixed_cloud_repo_config_id")
        _drop_column_once("slack_bot_config", "allowed_cloud_repo_config_ids")
        if not _has_constraint(
            "slack_bot_config",
            "slack_bot_config_fixed_repo_environment_id_fkey",
        ):
            op.create_foreign_key(
                "slack_bot_config_fixed_repo_environment_id_fkey",
                "slack_bot_config",
                "repo_environment",
                ["fixed_repo_environment_id"],
                ["id"],
                ondelete="SET NULL",
            )
        if not _has_constraint("slack_bot_config", "ck_slack_bot_config_fixed_repo_present"):
            op.create_check_constraint(
                "ck_slack_bot_config_fixed_repo_present",
                "slack_bot_config",
                "repo_mode != 'fixed' OR fixed_repo_environment_id IS NOT NULL",
            )

    if _has_table("slack_thread_work"):
        _add_column_once(
            "slack_thread_work",
            sa.Column("initial_repo_environment_id", sa.Uuid(), nullable=True),
        )
        if _has_column("slack_thread_work", "initial_repo_id"):
            op.execute(
                """
                UPDATE slack_thread_work
                SET initial_repo_environment_id = initial_repo_id
                WHERE initial_repo_environment_id IS NULL
                """
            )
        _drop_constraint_once(
            "slack_thread_work_cloud_workspace_exposure_id_fkey",
            "slack_thread_work",
            type_="foreignkey",
        )
        _drop_constraint_once(
            "slack_thread_work_cloud_session_projection_id_fkey",
            "slack_thread_work",
            type_="foreignkey",
        )
        _drop_constraint_once(
            "slack_thread_work_initial_repo_id_fkey",
            "slack_thread_work",
            type_="foreignkey",
        )
        _drop_column_once("slack_thread_work", "cloud_workspace_exposure_id")
        _drop_column_once("slack_thread_work", "cloud_session_projection_id")
        _drop_column_once("slack_thread_work", "initial_repo_id")
        if not _has_constraint(
            "slack_thread_work",
            "slack_thread_work_initial_repo_environment_id_fkey",
        ):
            op.create_foreign_key(
                "slack_thread_work_initial_repo_environment_id_fkey",
                "slack_thread_work",
                "repo_environment",
                ["initial_repo_environment_id"],
                ["id"],
                ondelete="RESTRICT",
            )

    if _has_table("cloud_repo_routing_profile"):
        _add_column_once(
            "cloud_repo_routing_profile",
            sa.Column("repo_environment_id", sa.Uuid(), nullable=True),
        )
        if _has_column("cloud_repo_routing_profile", "cloud_repo_config_id"):
            op.execute(
                """
                UPDATE cloud_repo_routing_profile
                SET repo_environment_id = cloud_repo_config_id
                WHERE repo_environment_id IS NULL
                """
            )
        _drop_constraint_once(
            "cloud_repo_routing_profile_cloud_repo_config_id_fkey",
            "cloud_repo_routing_profile",
            type_="foreignkey",
        )
        _drop_column_once("cloud_repo_routing_profile", "cloud_repo_config_id")
        if not _has_constraint(
            "cloud_repo_routing_profile",
            "cloud_repo_routing_profile_repo_environment_id_fkey",
        ):
            op.create_foreign_key(
                "cloud_repo_routing_profile_repo_environment_id_fkey",
                "cloud_repo_routing_profile",
                "repo_environment",
                ["repo_environment_id"],
                ["id"],
                ondelete="CASCADE",
            )


def _upgrade_automation_tables() -> None:
    if _has_table("automation"):
        _add_column_once(
            "automation",
            sa.Column("repo_environment_id", sa.Uuid(), nullable=True),
        )
        if _has_column("automation", "cloud_repo_config_id"):
            op.execute(
                """
                UPDATE automation
                SET repo_environment_id = cloud_repo_config_id
                WHERE repo_environment_id IS NULL
                """
            )
        _drop_index_once("ix_automation_cloud_repo_config_id", "automation")
        _drop_constraint_once(
            "automation_cloud_repo_config_id_fkey",
            "automation",
            type_="foreignkey",
        )
        _drop_column_once("automation", "cloud_repo_config_id")
        if not _has_constraint("automation", "automation_repo_environment_id_fkey"):
            op.create_foreign_key(
                "automation_repo_environment_id_fkey",
                "automation",
                "repo_environment",
                ["repo_environment_id"],
                ["id"],
                ondelete="RESTRICT",
            )
        _create_index_once(
            "ix_automation_repo_environment_id",
            "automation",
            ["repo_environment_id"],
        )

    if _has_table("automation_run"):
        _add_column_once(
            "automation_run",
            sa.Column("repo_environment_id_snapshot", sa.Uuid(), nullable=True),
        )
        if _has_column("automation_run", "cloud_repo_config_id_snapshot"):
            op.execute(
                """
                UPDATE automation_run
                SET repo_environment_id_snapshot = cloud_repo_config_id_snapshot
                WHERE repo_environment_id_snapshot IS NULL
                """
            )
        _drop_index_once("ix_automation_run_cloud_target_id_snapshot", "automation_run")
        _drop_index_once("ix_automation_run_sandbox_profile_id", "automation_run")
        _drop_index_once("ix_automation_run_cloud_workspace_exposure_id", "automation_run")
        _drop_constraint_once(
            "automation_run_cloud_repo_config_id_snapshot_fkey",
            "automation_run",
            type_="foreignkey",
        )
        _drop_constraint_once(
            "automation_run_cloud_target_id_snapshot_fkey",
            "automation_run",
            type_="foreignkey",
        )
        _drop_constraint_once(
            "automation_run_sandbox_profile_id_fkey",
            "automation_run",
            type_="foreignkey",
        )
        _drop_constraint_once(
            "automation_run_cloud_workspace_exposure_id_fkey",
            "automation_run",
            type_="foreignkey",
        )
        _drop_column_once("automation_run", "cloud_repo_config_id_snapshot")
        _drop_column_once("automation_run", "cloud_target_id_snapshot")
        _drop_column_once("automation_run", "cloud_target_kind_snapshot")
        _drop_column_once("automation_run", "sandbox_profile_id")
        _drop_column_once("automation_run", "cloud_workspace_exposure_id")
        if not _has_constraint(
            "automation_run",
            "automation_run_repo_environment_id_snapshot_fkey",
        ):
            op.create_foreign_key(
                "automation_run_repo_environment_id_snapshot_fkey",
                "automation_run",
                "repo_environment",
                ["repo_environment_id_snapshot"],
                ["id"],
                ondelete="RESTRICT",
            )
        _create_index_once(
            "ix_automation_run_repo_environment_id_snapshot",
            "automation_run",
            ["repo_environment_id_snapshot"],
        )


def _upgrade_mobility_tables() -> None:
    if not _has_table("cloud_workspace_move_cleanup_item"):
        return
    _add_column_once(
        "cloud_workspace_move_cleanup_item",
        sa.Column("cloud_sandbox_id", sa.Uuid(), nullable=True),
    )
    if _has_column("cloud_workspace_move_cleanup_item", "target_id") and _has_column(
        "cloud_sandbox",
        "target_id",
    ):
        op.execute(
            """
            UPDATE cloud_workspace_move_cleanup_item AS item
            SET cloud_sandbox_id = sandbox.id
            FROM cloud_sandbox AS sandbox
            WHERE item.cloud_sandbox_id IS NULL
              AND item.target_id = sandbox.target_id
            """
        )
    _drop_constraint_once(
        "ck_cloud_workspace_move_cleanup_item_kind",
        "cloud_workspace_move_cleanup_item",
        type_="check",
    )
    _drop_constraint_once(
        "cloud_workspace_move_cleanup_item_target_id_fkey",
        "cloud_workspace_move_cleanup_item",
        type_="foreignkey",
    )
    _drop_column_once("cloud_workspace_move_cleanup_item", "target_id")
    if not _has_constraint(
        "cloud_workspace_move_cleanup_item",
        "cloud_workspace_move_cleanup_item_cloud_sandbox_id_fkey",
    ):
        op.create_foreign_key(
            "cloud_workspace_move_cleanup_item_cloud_sandbox_id_fkey",
            "cloud_workspace_move_cleanup_item",
            "cloud_sandbox",
            ["cloud_sandbox_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if not _has_constraint(
        "cloud_workspace_move_cleanup_item",
        "ck_cloud_workspace_move_cleanup_item_kind",
    ):
        op.create_check_constraint(
            "ck_cloud_workspace_move_cleanup_item_kind",
            "cloud_workspace_move_cleanup_item",
            "item_kind IN ('anyharness_workspace', 'cloud_workspace')",
        )


def _drop_legacy_cloud_tables() -> None:
    for table_name in (
        "cloud_workspace_setup_run",
        "cloud_workspace_claim_token",
        "cloud_transcript_items",
        "cloud_pending_interactions",
        "cloud_session_events",
        "cloud_event_ingest_state",
        "cloud_workspace_claim",
        "cloud_sessions",
        "cloud_synced_workspaces",
        "cloud_workspace_exposure",
        "cloud_worker_target_control_state",
        "cloud_target_runtime_access",
        "cloud_target_configs",
        "cloud_target_git_identities",
        "sandbox_profile_runtime_config_artifact",
        "sandbox_profile_runtime_config_current",
        "sandbox_profile_runtime_config_revision",
        "sandbox_profile_target_state",
        "sandbox_profile_agent_auth_revision",
        "cloud_runtime_environment",
        "cloud_target_inventory",
        "cloud_target_status",
        "cloud_target_enrollments",
        "cloud_commands",
        "cloud_workers",
        "cloud_targets",
        "sandbox_profile",
        "cloud_repo_file",
        "cloud_repo_config",
    ):
        if _has_table(table_name):
            op.drop_table(table_name)


def _drop_managed_sandbox_table() -> None:
    if _has_table("managed_sandbox"):
        op.drop_table("managed_sandbox")


def _drop_repo_materialization_table() -> None:
    if _has_table("managed_sandbox_repo_materialization"):
        op.drop_table("managed_sandbox_repo_materialization")


def _upgrade_cloud_workspace() -> None:
    if not _has_table("cloud_workspace"):
        return
    _add_column_once(
        "cloud_workspace",
        sa.Column("owner_user_id", sa.Uuid(), nullable=True),
    )
    _add_column_once(
        "cloud_workspace",
        sa.Column("repo_environment_id", sa.Uuid(), nullable=True),
    )
    if _has_column("cloud_workspace", "user_id"):
        op.execute(
            """
            UPDATE cloud_workspace
            SET owner_user_id = user_id
            WHERE owner_user_id IS NULL
              AND user_id IS NOT NULL
            """
        )
    if _has_column("cloud_workspace", "git_owner") and _has_column(
        "cloud_workspace",
        "git_repo_name",
    ):
        op.execute(
            """
            UPDATE cloud_workspace AS workspace
            SET repo_environment_id = environment.id
            FROM repo_environment AS environment
            JOIN repo_config AS repo ON repo.id = environment.repo_config_id
            WHERE workspace.repo_environment_id IS NULL
              AND environment.environment_kind = 'cloud'
              AND environment.deleted_at IS NULL
              AND repo.user_id = COALESCE(workspace.owner_user_id, workspace.user_id)
              AND repo.git_provider = workspace.git_provider
              AND repo.git_owner = workspace.git_owner
              AND repo.git_repo_name = workspace.git_repo_name
            """
        )
    op.execute(
        """
        DELETE FROM cloud_workspace AS workspace
        WHERE workspace.owner_user_id IS NULL
           OR workspace.repo_environment_id IS NULL
           OR workspace.anyharness_workspace_id IS NULL
           OR NOT EXISTS (
                SELECT 1 FROM "user" AS owner_user
                WHERE owner_user.id = workspace.owner_user_id
           )
           OR NOT EXISTS (
                SELECT 1 FROM repo_environment AS environment
                WHERE environment.id = workspace.repo_environment_id
           )
        """
    )
    op.execute(
        """
        UPDATE cloud_workspace
        SET display_name = COALESCE(
          NULLIF(display_name, ''),
          'Workspace ' || substring(id::text from 1 for 8)
        )
        WHERE display_name IS NULL
           OR display_name = ''
        """
    )
    if not _has_constraint("cloud_workspace", "cloud_workspace_owner_user_id_fkey"):
        op.create_foreign_key(
            "cloud_workspace_owner_user_id_fkey",
            "cloud_workspace",
            "user",
            ["owner_user_id"],
            ["id"],
            ondelete="CASCADE",
        )
    if not _has_constraint("cloud_workspace", "cloud_workspace_repo_environment_id_fkey"):
        op.create_foreign_key(
            "cloud_workspace_repo_environment_id_fkey",
            "cloud_workspace",
            "repo_environment",
            ["repo_environment_id"],
            ["id"],
            ondelete="RESTRICT",
        )
    _alter_nullable("cloud_workspace", "owner_user_id", nullable=False)
    _alter_nullable("cloud_workspace", "repo_environment_id", nullable=False)
    _alter_nullable("cloud_workspace", "display_name", nullable=False)
    _alter_nullable("cloud_workspace", "anyharness_workspace_id", nullable=False)
    _create_index_once(
        "ix_cloud_workspace_owner_user_id",
        "cloud_workspace",
        ["owner_user_id"],
    )
    _create_index_once(
        "ix_cloud_workspace_repo_environment_id",
        "cloud_workspace",
        ["repo_environment_id"],
    )
    _create_index_once(
        "ix_cloud_workspace_anyharness_workspace_id",
        "cloud_workspace",
        ["anyharness_workspace_id"],
    )
    _drop_index_once("ux_cloud_workspace_anyharness_workspace", "cloud_workspace")
    _create_index_once(
        "ux_cloud_workspace_anyharness_workspace",
        "cloud_workspace",
        ["owner_user_id", "anyharness_workspace_id"],
        unique=True,
        postgresql_where=sa.text("archived_at IS NULL AND anyharness_workspace_id IS NOT NULL"),
    )
    _drop_constraint_once(
        "cloud_workspace_user_id_fkey",
        "cloud_workspace",
        type_="foreignkey",
    )
    _drop_constraint_once(
        "cloud_workspace_billing_subject_id_fkey",
        "cloud_workspace",
        type_="foreignkey",
    )
    _drop_constraint_once(
        "cloud_workspace_created_by_user_id_fkey",
        "cloud_workspace",
        type_="foreignkey",
    )
    _drop_constraint_once(
        "cloud_workspace_sandbox_profile_id_fkey",
        "cloud_workspace",
        type_="foreignkey",
    )
    _drop_constraint_once(
        "cloud_workspace_target_id_fkey",
        "cloud_workspace",
        type_="foreignkey",
    )
    _drop_constraint_once(
        "cloud_workspace_materialized_target_id_fkey",
        "cloud_workspace",
        type_="foreignkey",
    )
    for constraint_name in (
        "ck_cloud_workspace_owner_scope",
        "ck_cloud_workspace_personal_owner",
        "ck_cloud_workspace_organization_owner",
        "ck_cloud_workspace_created_by_user_id",
        "ck_cloud_workspace_origin",
    ):
        _drop_constraint_once(constraint_name, "cloud_workspace", type_="check")
    for index_name in (
        "ix_cloud_workspace_user_id",
        "ix_cloud_workspace_organization_id",
        "ix_cloud_workspace_created_by_user_id",
        "ix_cloud_workspace_runtime_environment_id",
        "ix_cloud_workspace_billing_subject_id",
        "ix_cloud_workspace_sandbox_profile_id",
        "ix_cloud_workspace_target_id",
        "ix_cloud_workspace_materialized_target_id",
        "uq_cloud_workspace_active_branch",
        "ux_cloud_workspace_active_per_branch",
        "ux_cloud_workspace_active_worktree_path",
    ):
        _drop_index_once(index_name, "cloud_workspace")
    _drop_column_once("cloud_workspace", "user_id")
    _drop_column_once("cloud_workspace", "owner_scope")
    _drop_column_once("cloud_workspace", "organization_id")
    _drop_column_once("cloud_workspace", "runtime_environment_id")
    _drop_column_once("cloud_workspace", "git_provider")
    _drop_column_once("cloud_workspace", "git_owner")
    _drop_column_once("cloud_workspace", "git_repo_name")
    _drop_column_once("cloud_workspace", "git_branch")
    _drop_column_once("cloud_workspace", "git_base_branch")
    _drop_column_once("cloud_workspace", "base_ref")
    _drop_column_once("cloud_workspace", "base_sha")
    _drop_column_once("cloud_workspace", "status")
    _drop_column_once("cloud_workspace", "status_detail")
    _drop_column_once("cloud_workspace", "last_error")
    _drop_column_once("cloud_workspace", "template_version")
    _drop_column_once("cloud_workspace", "billing_subject_id")
    _drop_column_once("cloud_workspace", "created_by_user_id")
    _drop_column_once("cloud_workspace", "active_sandbox_id")
    _drop_column_once("cloud_workspace", "runtime_url")
    _drop_column_once("cloud_workspace", "runtime_token_ciphertext")
    _drop_column_once("cloud_workspace", "runtime_generation")
    _drop_column_once("cloud_workspace", "anyharness_data_key_ciphertext")
    _drop_column_once("cloud_workspace", "sandbox_profile_id")
    _drop_column_once("cloud_workspace", "target_id")
    _drop_column_once("cloud_workspace", "normalized_repo_key")
    _drop_column_once("cloud_workspace", "worktree_path")
    _drop_column_once("cloud_workspace", "materialized_target_id")
    _drop_column_once("cloud_workspace", "required_runtime_config_sequence")
    _drop_column_once("cloud_workspace", "required_runtime_config_revision_id")
    _drop_column_once("cloud_workspace", "required_agent_auth_revision")
    _drop_column_once("cloud_workspace", "repo_env_vars_ciphertext")
    _drop_column_once("cloud_workspace", "repo_files_applied_version")
    _drop_column_once("cloud_workspace", "repo_setup_applied_version")
    _drop_column_once("cloud_workspace", "repo_post_ready_phase")
    _drop_column_once("cloud_workspace", "repo_post_ready_files_total")
    _drop_column_once("cloud_workspace", "repo_post_ready_files_applied")
    _drop_column_once("cloud_workspace", "repo_post_ready_apply_token")
    _drop_column_once("cloud_workspace", "repo_files_last_failed_path")
    _drop_column_once("cloud_workspace", "repo_files_last_error")
    _drop_column_once("cloud_workspace", "repo_files_applied_at")
    _drop_column_once("cloud_workspace", "repo_post_ready_started_at")
    _drop_column_once("cloud_workspace", "repo_post_ready_completed_at")
    _drop_column_once("cloud_workspace", "ready_at")
    _drop_column_once("cloud_workspace", "stopped_at")
    _drop_column_once("cloud_workspace", "archive_requested_at")
    _drop_column_once("cloud_workspace", "cleanup_state")
    _drop_column_once("cloud_workspace", "cleanup_last_error")
    _drop_column_once("cloud_workspace", "origin")
    _drop_column_once("cloud_workspace", "origin_json")


def upgrade() -> None:
    _create_repo_config_tables()
    _backfill_repo_config_tables()
    _drop_cloud_sandbox_analytics_views()
    _upgrade_agent_auth_tables()
    _upgrade_slack_tables()
    _upgrade_automation_tables()
    _upgrade_mobility_tables()
    _upgrade_cloud_sandbox()
    _create_cloud_sandbox_analytics_views()
    _upgrade_secret_tables()
    _drop_repo_materialization_table()
    _drop_managed_sandbox_table()
    _drop_cloud_workspace_analytics_views()
    _upgrade_cloud_workspace()
    _create_cloud_workspace_analytics_views()
    _drop_legacy_cloud_analytics_views()
    _drop_legacy_repo_config_links()
    _drop_legacy_cloud_tables()


def downgrade() -> None:
    _drop_index_once("ux_cloud_workspace_anyharness_workspace", "cloud_workspace")
    _drop_index_once("ix_cloud_workspace_repo_environment_id", "cloud_workspace")
    _drop_constraint_once(
        "cloud_workspace_repo_environment_id_fkey",
        "cloud_workspace",
        type_="foreignkey",
    )
    _drop_constraint_once(
        "cloud_workspace_owner_user_id_fkey",
        "cloud_workspace",
        type_="foreignkey",
    )
    if _has_column("cloud_workspace", "repo_environment_id"):
        op.drop_column("cloud_workspace", "repo_environment_id")

    _add_column_once(
        "cloud_sandbox",
        sa.Column("template_version", sa.String(length=64), nullable=False, server_default="v1"),
    )
    _add_column_once(
        "cloud_sandbox",
        sa.Column("last_provider_event_at", sa.DateTime(timezone=True), nullable=True),
    )
    _add_column_once(
        "cloud_sandbox",
        sa.Column("last_provider_event_kind", sa.String(length=64), nullable=True),
    )
    _add_column_once("cloud_sandbox", sa.Column("sandbox_profile_id", sa.Uuid(), nullable=True))
    if not _has_constraint("cloud_sandbox", "cloud_sandbox_sandbox_profile_id_fkey"):
        op.create_foreign_key(
            "cloud_sandbox_sandbox_profile_id_fkey",
            "cloud_sandbox",
            "sandbox_profile",
            ["sandbox_profile_id"],
            ["id"],
            ondelete="CASCADE",
        )
    if not _has_constraint("cloud_sandbox", "ck_cloud_sandbox_managed_target_identity"):
        op.create_check_constraint(
            "ck_cloud_sandbox_managed_target_identity",
            "cloud_sandbox",
            "(sandbox_profile_id IS NULL AND target_id IS NULL AND billing_subject_id IS NULL) "
            "OR (sandbox_profile_id IS NOT NULL AND target_id IS NOT NULL "
            "AND billing_subject_id IS NOT NULL)",
        )
    _create_index_once(
        "ix_cloud_sandbox_sandbox_profile_id",
        "cloud_sandbox",
        ["sandbox_profile_id"],
    )

    if _has_table("repo_environment"):
        op.drop_table("repo_environment")
    if _has_table("repo_config"):
        op.drop_table("repo_config")
