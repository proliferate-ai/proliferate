"""automation cloud executor state

Revision ID: b9c0d1e2f3a4
Revises: a8b9c0d1e2f3
Create Date: 2026-04-21 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b9c0d1e2f3a4"
down_revision: str | Sequence[str] | None = "a8b9c0d1e2f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _columns(table_name: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {column["name"] for column in inspector.get_columns(table_name)}


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def _has_constraint(table_name: str, constraint_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    constraints = inspector.get_check_constraints(table_name)
    constraints += inspector.get_foreign_keys(table_name)
    return constraint_name in {constraint["name"] for constraint in constraints}


def upgrade() -> None:
    if not _has_table("automation_run"):
        return

    existing_columns = _columns("automation_run")
    for name, column in (
        ("title_snapshot", sa.Column("title_snapshot", sa.String(length=255), nullable=True)),
        ("prompt_snapshot", sa.Column("prompt_snapshot", sa.Text(), nullable=True)),
        (
            "git_provider_snapshot",
            sa.Column("git_provider_snapshot", sa.String(length=32), nullable=True),
        ),
        (
            "git_owner_snapshot",
            sa.Column("git_owner_snapshot", sa.String(length=255), nullable=True),
        ),
        (
            "git_repo_name_snapshot",
            sa.Column("git_repo_name_snapshot", sa.String(length=255), nullable=True),
        ),
        (
            "cloud_repo_config_id_snapshot",
            sa.Column("cloud_repo_config_id_snapshot", sa.Uuid(), nullable=True),
        ),
        (
            "agent_kind_snapshot",
            sa.Column("agent_kind_snapshot", sa.String(length=32), nullable=True),
        ),
        (
            "model_id_snapshot",
            sa.Column("model_id_snapshot", sa.String(length=255), nullable=True),
        ),
        ("mode_id_snapshot", sa.Column("mode_id_snapshot", sa.String(length=255), nullable=True)),
        (
            "reasoning_effort_snapshot",
            sa.Column("reasoning_effort_snapshot", sa.String(length=64), nullable=True),
        ),
        ("executor_kind", sa.Column("executor_kind", sa.String(length=32), nullable=True)),
        ("executor_id", sa.Column("executor_id", sa.String(length=255), nullable=True)),
        ("claim_id", sa.Column("claim_id", sa.Uuid(), nullable=True)),
        ("claimed_at", sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True)),
        (
            "claim_expires_at",
            sa.Column("claim_expires_at", sa.DateTime(timezone=True), nullable=True),
        ),
        (
            "last_heartbeat_at",
            sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        ),
        ("cloud_workspace_id", sa.Column("cloud_workspace_id", sa.Uuid(), nullable=True)),
        (
            "anyharness_workspace_id",
            sa.Column("anyharness_workspace_id", sa.String(length=255), nullable=True),
        ),
        (
            "anyharness_session_id",
            sa.Column("anyharness_session_id", sa.String(length=255), nullable=True),
        ),
        (
            "dispatch_started_at",
            sa.Column("dispatch_started_at", sa.DateTime(timezone=True), nullable=True),
        ),
        ("dispatched_at", sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True)),
        ("failed_at", sa.Column("failed_at", sa.DateTime(timezone=True), nullable=True)),
        ("last_error_code", sa.Column("last_error_code", sa.String(length=64), nullable=True)),
        ("last_error_message", sa.Column("last_error_message", sa.Text(), nullable=True)),
    ):
        if name not in existing_columns:
            op.add_column("automation_run", column)

    op.execute(
        sa.text(
            """
            UPDATE automation_run AS run
            SET
              title_snapshot = COALESCE(run.title_snapshot, automation.title),
              prompt_snapshot = COALESCE(run.prompt_snapshot, automation.prompt),
              git_provider_snapshot = COALESCE(run.git_provider_snapshot, 'github'),
              git_owner_snapshot = COALESCE(run.git_owner_snapshot, repo.git_owner),
              git_repo_name_snapshot = COALESCE(run.git_repo_name_snapshot, repo.git_repo_name),
              cloud_repo_config_id_snapshot = COALESCE(
                run.cloud_repo_config_id_snapshot,
                automation.cloud_repo_config_id
              ),
              agent_kind_snapshot = COALESCE(run.agent_kind_snapshot, automation.agent_kind),
              model_id_snapshot = COALESCE(run.model_id_snapshot, automation.model_id),
              mode_id_snapshot = COALESCE(run.mode_id_snapshot, automation.mode_id),
              reasoning_effort_snapshot = COALESCE(
                run.reasoning_effort_snapshot,
                automation.reasoning_effort
              )
            FROM automation
            JOIN cloud_repo_config AS repo ON repo.id = automation.cloud_repo_config_id
            WHERE run.automation_id = automation.id
            """
        )
    )

    if "last_error" in existing_columns:
        op.execute(
            sa.text(
                """
                UPDATE automation_run
                SET last_error_message = COALESCE(last_error_message, last_error)
                WHERE last_error IS NOT NULL
                """
            )
        )
        op.drop_column("automation_run", "last_error")

    op.execute(
        sa.text(
            """
            UPDATE automation
            SET enabled = false,
                paused_at = COALESCE(paused_at, now()),
                next_run_at = NULL,
                updated_at = now()
            WHERE execution_target = 'cloud'
              AND agent_kind IS NULL
              AND enabled = true
            """
        )
    )

    for name in (
        "title_snapshot",
        "prompt_snapshot",
        "git_provider_snapshot",
        "git_owner_snapshot",
        "git_repo_name_snapshot",
        "cloud_repo_config_id_snapshot",
    ):
        op.alter_column("automation_run", name, nullable=False)

    if _has_constraint("automation_run", "ck_automation_run_status"):
        op.drop_constraint("ck_automation_run_status", "automation_run", type_="check")
    op.create_check_constraint(
        "ck_automation_run_status",
        "automation_run",
        (
            "status IN ("
            "'queued', "
            "'claimed', "
            "'creating_workspace', "
            "'provisioning_workspace', "
            "'creating_session', "
            "'dispatching', "
            "'dispatched', "
            "'failed', "
            "'cancelled'"
            ")"
        ),
    )

    if not _has_constraint("automation_run", "fk_automation_run_cloud_repo_config_snapshot"):
        op.create_foreign_key(
            "fk_automation_run_cloud_repo_config_snapshot",
            "automation_run",
            "cloud_repo_config",
            ["cloud_repo_config_id_snapshot"],
            ["id"],
            ondelete="RESTRICT",
        )
    if not _has_constraint("automation_run", "fk_automation_run_cloud_workspace"):
        op.create_foreign_key(
            "fk_automation_run_cloud_workspace",
            "automation_run",
            "cloud_workspace",
            ["cloud_workspace_id"],
            ["id"],
            ondelete="SET NULL",
        )

    if not _has_index("automation_run", "ix_automation_run_cloud_claimable"):
        op.create_index(
            "ix_automation_run_cloud_claimable",
            "automation_run",
            ["created_at"],
            unique=False,
            postgresql_where=sa.text(
                "execution_target = 'cloud' "
                "AND status IN ("
                "'queued', "
                "'claimed', "
                "'creating_workspace', "
                "'provisioning_workspace', "
                "'creating_session'"
                ")"
            ),
        )
    if not _has_index("automation_run", "ix_automation_run_cloud_claim_expiry"):
        op.create_index(
            "ix_automation_run_cloud_claim_expiry",
            "automation_run",
            ["claim_expires_at"],
            unique=False,
            postgresql_where=sa.text(
                "execution_target = 'cloud' "
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
    if not _has_index("automation_run", "ix_automation_run_cloud_workspace_id"):
        op.create_index(
            "ix_automation_run_cloud_workspace_id",
            "automation_run",
            ["cloud_workspace_id"],
            unique=False,
        )


def downgrade() -> None:
    if not _has_table("automation_run"):
        return

    existing_columns = _columns("automation_run")

    for index_name in (
        "ix_automation_run_cloud_workspace_id",
        "ix_automation_run_cloud_claim_expiry",
        "ix_automation_run_cloud_claimable",
    ):
        if _has_index("automation_run", index_name):
            op.drop_index(index_name, table_name="automation_run")

    if _has_constraint("automation_run", "fk_automation_run_cloud_workspace"):
        op.drop_constraint(
            "fk_automation_run_cloud_workspace",
            "automation_run",
            type_="foreignkey",
        )
    if _has_constraint("automation_run", "fk_automation_run_cloud_repo_config_snapshot"):
        op.drop_constraint(
            "fk_automation_run_cloud_repo_config_snapshot",
            "automation_run",
            type_="foreignkey",
        )

    if _has_constraint("automation_run", "ck_automation_run_status"):
        op.drop_constraint("ck_automation_run_status", "automation_run", type_="check")
    cancelled_at_update = (
        ", cancelled_at = COALESCE(cancelled_at, NOW())"
        if "cancelled_at" in existing_columns
        else ""
    )
    op.execute(
        sa.text(
            f"""
            UPDATE automation_run
            SET status = 'cancelled'{cancelled_at_update}
            WHERE status NOT IN ('queued', 'cancelled')
            """
        )
    )
    op.create_check_constraint(
        "ck_automation_run_status",
        "automation_run",
        "status IN ('queued', 'cancelled')",
    )

    if "last_error" not in existing_columns:
        op.add_column("automation_run", sa.Column("last_error", sa.Text(), nullable=True))
        op.execute(
            sa.text(
                """
                UPDATE automation_run
                SET last_error = last_error_message
                WHERE last_error_message IS NOT NULL
                """
            )
        )
        existing_columns.add("last_error")
    for name in (
        "last_error_message",
        "last_error_code",
        "failed_at",
        "dispatched_at",
        "dispatch_started_at",
        "anyharness_session_id",
        "anyharness_workspace_id",
        "cloud_workspace_id",
        "last_heartbeat_at",
        "claim_expires_at",
        "claimed_at",
        "claim_id",
        "executor_id",
        "executor_kind",
        "reasoning_effort_snapshot",
        "mode_id_snapshot",
        "model_id_snapshot",
        "agent_kind_snapshot",
        "cloud_repo_config_id_snapshot",
        "git_repo_name_snapshot",
        "git_owner_snapshot",
        "git_provider_snapshot",
        "prompt_snapshot",
        "title_snapshot",
    ):
        if name in existing_columns:
            op.drop_column("automation_run", name)
