"""workflow materialization offer and binding identity foundation

Revision ID: e5f1a2b3c4d7
Revises: a7e2c4f1b9d0
Create Date: 2026-07-11 12:00:00.000000

The offer credential is materialization-only. Plaintext is never stored; only
its random salt and salted SHA-256 digest are durable. Final execution/report/
control/integration credentials are intentionally absent from this revision.

Marking legacy rows failed and revoking server tokens does not terminate old
AnyHarness actors or their shell/SCM descendants. A populated upgrade therefore
requires a coordinated runtime-first drain acknowledgement; this migration is
not itself cancellation evidence and WF-ID does not authorize production rollout.
"""

import os
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e5f1a2b3c4d7"
down_revision: str | Sequence[str] | None = "a7e2c4f1b9d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_DRAIN_ACK_ENV = "PROLIFERATE_WF_ID_LEGACY_DRAIN_ACK"
_DRAIN_ACK_VALUE = "actors-and-process-groups-verified-zero"


def _has_table(name: str) -> bool:
    return name in set(sa.inspect(op.get_bind()).get_table_names())


def _has_column(table: str, column: str) -> bool:
    return column in {item["name"] for item in sa.inspect(op.get_bind()).get_columns(table)}


def _require_populated_runtime_drain() -> None:
    if not _has_table("workflow_run"):
        return
    # Serialize against every pre-cutover writer, including the two child ledgers
    # that can independently authorize a gateway call or retry an external action.
    # These locks live until the migration transaction commits; no old writer can
    # slip between inventory, revocation, and installation of the no-default
    # writer-version columns.
    writer_tables = [
        table
        for table in (
            "workflow_run",
            "cloud_workflow_run_gateway_token",
            "workflow_step_action",
        )
        if _has_table(table)
    ]
    op.get_bind().execute(
        sa.text(f"LOCK TABLE {', '.join(writer_tables)} IN ACCESS EXCLUSIVE MODE")
    )
    inventory = " OR ".join(
        f"EXISTS (SELECT 1 FROM {table})" for table in writer_tables
    )
    has_legacy_rows = bool(
        op.get_bind().execute(sa.text(f"SELECT {inventory}")).scalar()
    )
    if has_legacy_rows and os.environ.get(_DRAIN_ACK_ENV) != _DRAIN_ACK_VALUE:
        raise RuntimeError(
            "WF-ID populated migration blocked: deploy runtime feature-off first, "
            "drain/kill every legacy AnyHarness/Desktop/cloud actor and shell/SCM "
            f"process group, verify zero, then set {_DRAIN_ACK_ENV}="
            f"{_DRAIN_ACK_VALUE} for the migration job only."
        )


def upgrade() -> None:
    _require_populated_runtime_drain()
    if _has_table("repo_environment") and not _has_column(
        "repo_environment", "generation"
    ):
        op.add_column(
            "repo_environment",
            sa.Column("generation", sa.Integer(), server_default="1", nullable=False),
        )
        op.create_check_constraint(
            "ck_repo_environment_generation", "repo_environment", "generation > 0"
        )
    if _has_table("cloud_workspace") and not _has_column("cloud_workspace", "generation"):
        op.add_column(
            "cloud_workspace",
            sa.Column("generation", sa.Integer(), server_default="1", nullable=False),
        )
        op.create_check_constraint(
            "ck_cloud_workspace_generation", "cloud_workspace", "generation > 0"
        )
    if _has_table("cloud_runtime_worker") and not _has_column(
        "cloud_runtime_worker", "generation"
    ):
        op.add_column(
            "cloud_runtime_worker",
            sa.Column("generation", sa.Integer(), nullable=True),
        )
        op.execute(
            """
            WITH ranked AS (
                SELECT id,
                       row_number() OVER (
                           PARTITION BY runtime_kind,
                                        cloud_sandbox_id, desktop_install_id
                           ORDER BY enrolled_at, id
                       ) AS generation
                FROM cloud_runtime_worker
            )
            UPDATE cloud_runtime_worker AS worker
            SET generation = ranked.generation
            FROM ranked
            WHERE worker.id = ranked.id
            """
        )
        op.alter_column("cloud_runtime_worker", "generation", nullable=False)
        op.create_check_constraint(
            "ck_cloud_runtime_worker_generation",
            "cloud_runtime_worker",
            "generation > 0",
        )
        op.create_index(
            "ux_cloud_runtime_worker_sandbox_generation",
            "cloud_runtime_worker",
            ["cloud_sandbox_id", "generation"],
            unique=True,
            postgresql_where=sa.text("cloud_sandbox_id IS NOT NULL"),
        )
        op.create_index(
            "ux_cloud_runtime_worker_desktop_generation",
            "cloud_runtime_worker",
            ["desktop_install_id", "generation"],
            unique=True,
            postgresql_where=sa.text("desktop_install_id IS NOT NULL"),
        )
    if _has_table("workflow_run"):
        if not _has_column("workflow_run", "identity_schema_version"):
            op.add_column(
                "workflow_run",
                sa.Column("identity_schema_version", sa.Integer(), nullable=True),
            )
        if not _has_column("workflow_run", "identity_cutover_parked"):
            op.add_column(
                "workflow_run",
                sa.Column("identity_cutover_parked", sa.Boolean(), nullable=True),
            )
        op.execute(
            "UPDATE workflow_run SET identity_schema_version = 1, "
            "identity_cutover_parked = true"
        )
        for name in (
            "claim_generation",
            "claimed_workspace_generation",
        ):
            if not _has_column("workflow_run", name):
                op.add_column("workflow_run", sa.Column(name, sa.Integer(), nullable=True))
        if not _has_column("workflow_run", "claimed_workspace_id"):
            op.add_column(
                "workflow_run",
                sa.Column("claimed_workspace_id", sa.String(length=255), nullable=True),
            )
    if _has_table("workflow_trigger") and not _has_column(
        "workflow_trigger", "local_workspace_id"
    ):
        op.drop_constraint(
            "ck_workflow_trigger_target_workspace", "workflow_trigger", type_="check"
        )
        op.add_column(
            "workflow_trigger",
            sa.Column("local_workspace_id", sa.Uuid(), nullable=True),
        )
        # Existing local triggers never pinned an executor workspace. Keep them
        # disabled and unpinned; an explicit edit must repin before re-enabling.
        op.execute(
            """
            UPDATE workflow_trigger
            SET enabled = false, local_workspace_id = NULL, updated_at = now()
            WHERE target_mode = 'local'
            """
        )
        op.create_check_constraint(
            "ck_workflow_trigger_target_workspace",
            "workflow_trigger",
            "(target_mode = 'personal_cloud' AND target_workspace_id IS NOT NULL "
            "AND local_workspace_id IS NULL) OR "
            "(target_mode = 'local' AND target_workspace_id IS NULL "
            "AND (enabled = false OR local_workspace_id IS NOT NULL))",
        )

    # Cutover: pre-WF-ID credentials cannot remain live. Existing runs did not
    # pass binding acceptance, so park every nonterminal row, revoke its tokens,
    # and purge every plaintext legacy private envelope before new code serves.
    if _has_table("cloud_workflow_run_gateway_token"):
        if not _has_column(
            "cloud_workflow_run_gateway_token", "identity_schema_version"
        ):
            op.add_column(
                "cloud_workflow_run_gateway_token",
                sa.Column("identity_schema_version", sa.Integer(), nullable=True),
            )
        if not _has_column(
            "cloud_workflow_run_gateway_token", "identity_cutover_parked"
        ):
            op.add_column(
                "cloud_workflow_run_gateway_token",
                sa.Column("identity_cutover_parked", sa.Boolean(), nullable=True),
            )
        op.execute(
            """
            UPDATE cloud_workflow_run_gateway_token
            SET status = CASE WHEN status = 'active' THEN 'expired' ELSE status END,
                expires_at = CASE WHEN status = 'active' THEN now() ELSE expires_at END,
                identity_schema_version = 1,
                identity_cutover_parked = true,
                updated_at = now()
            """
        )
        op.alter_column(
            "cloud_workflow_run_gateway_token", "identity_schema_version", nullable=False
        )
        op.alter_column(
            "cloud_workflow_run_gateway_token", "identity_cutover_parked", nullable=False
        )
        op.create_check_constraint(
            "ck_cloud_workflow_run_gateway_token_identity_writer_fence",
            "cloud_workflow_run_gateway_token",
            "identity_schema_version = 1 AND (NOT identity_cutover_parked "
            "OR status IN ('expired', 'revoked'))",
        )
    if _has_table("workflow_step_action"):
        if not _has_column("workflow_step_action", "identity_schema_version"):
            op.add_column(
                "workflow_step_action",
                sa.Column("identity_schema_version", sa.Integer(), nullable=True),
            )
        if not _has_column("workflow_step_action", "identity_cutover_parked"):
            op.add_column(
                "workflow_step_action",
                sa.Column("identity_cutover_parked", sa.Boolean(), nullable=True),
            )
        # Legacy pending/failed actions can otherwise survive run parking and
        # retry an external Slack send. Exhaust them irreversibly; WF-ID does not
        # claim that a previously sent side effect was or was not delivered.
        op.execute(
            """
            UPDATE workflow_step_action
            SET status = CASE WHEN status = 'done' THEN status ELSE 'failed' END,
                attempt_count = CASE
                    WHEN status = 'done' THEN attempt_count
                    ELSE GREATEST(attempt_count, 5)
                END,
                error_message = CASE
                    WHEN status = 'done' THEN error_message
                    ELSE 'Parked during deterministic-action cutover.'
                END,
                identity_schema_version = 1,
                identity_cutover_parked = status != 'done',
                updated_at = now()
            """
        )
        op.alter_column("workflow_step_action", "identity_schema_version", nullable=False)
        op.alter_column("workflow_step_action", "identity_cutover_parked", nullable=False)
        op.create_check_constraint(
            "ck_workflow_step_action_identity_writer_fence",
            "workflow_step_action",
            "identity_schema_version = 1 AND (NOT identity_cutover_parked OR ("
            "status = 'failed' AND attempt_count >= 5))",
        )
    if _has_table("workflow_run"):
        op.execute(
            "UPDATE workflow_run SET private_envelope_json = NULL "
            "WHERE private_envelope_json IS NOT NULL"
        )
        # Legacy logical plans were open JSON and may hold private authority under
        # arbitrary renamed/nested keys. Every legacy execution is parked, so keep
        # the run ledger but replace the untrusted blob rather than pretending a
        # known-key denylist is a scrub boundary.
        op.execute(
            "UPDATE workflow_run SET resolved_plan_json = '{}'::jsonb, "
            "plan_hash = NULL, plan_version = NULL, updated_at = now()"
        )
        op.execute(
            """
            UPDATE workflow_run
            SET status = 'failed',
                delivery_state = 'terminal_delivery_failure',
                error_code = 'workflow_identity_upgrade_required',
                error_message = 'Legacy run parked during strict identity cutover.',
                finished_at = COALESCE(finished_at, now()),
                updated_at = now()
            WHERE status NOT IN ('completed', 'failed', 'cancelled', 'missed')
            """
        )
        # No pre-migration row can have passed the new materialization-offer CAS.
        # Normalize even complete-looking raw legacy triples before constraining
        # the all-null/all-complete invariant.
        op.execute(
            """
            UPDATE workflow_run
            SET binding_hash = NULL,
                execution_generation = NULL,
                execution_binding_json = NULL
            WHERE binding_hash IS NOT NULL
               OR execution_generation IS NOT NULL
               OR execution_binding_json IS NOT NULL
            """
        )
        op.create_check_constraint(
            "ck_workflow_run_binding_identity_complete",
            "workflow_run",
            "(binding_hash IS NULL AND execution_generation IS NULL "
            "AND execution_binding_json IS NULL) OR "
            "(binding_hash IS NOT NULL AND execution_generation > 0 "
            "AND execution_binding_json IS NOT NULL)",
        )
        op.create_check_constraint(
            "ck_workflow_run_binding_hash_canonical",
            "workflow_run",
            "binding_hash IS NULL OR binding_hash ~ '^sha256:[0-9a-f]{64}$'",
        )
        op.alter_column("workflow_run", "identity_schema_version", nullable=False)
        op.alter_column("workflow_run", "identity_cutover_parked", nullable=False)
        op.create_check_constraint(
            "ck_workflow_run_identity_writer_fence",
            "workflow_run",
            "identity_schema_version = 1 AND (NOT identity_cutover_parked OR ("
            "status IN ('completed', 'failed', 'cancelled', 'missed') AND "
            "private_envelope_json IS NULL AND "
            "(jsonb_typeof(resolved_plan_json) != 'object' OR "
            "NOT (resolved_plan_json ? 'gateway')) AND "
            "binding_hash IS NULL AND execution_generation IS NULL AND "
            "execution_binding_json IS NULL))",
        )

    if _has_table("workflow_materialization_offer"):
        return
    op.create_table(
        "workflow_materialization_offer",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workflow_run_id", sa.Uuid(), nullable=False),
        sa.Column("plan_hash", sa.String(length=80), nullable=False),
        sa.Column("execution_generation", sa.Integer(), nullable=False),
        sa.Column("executor_id", sa.String(length=255), nullable=False),
        sa.Column("executor_fence", sa.String(length=255), nullable=False),
        sa.Column("workspace_id", sa.String(length=255), nullable=False),
        sa.Column("workspace_generation", sa.Integer(), nullable=False),
        sa.Column("executor_generation", sa.Integer(), nullable=False),
        sa.Column("audience", sa.String(length=64), nullable=False),
        sa.Column("credential_generation", sa.Integer(), server_default="1", nullable=False),
        sa.Column("credential_salt", sa.String(length=64), nullable=False),
        sa.Column("credential_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), server_default="'pending'", nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accepted_binding_hash", sa.String(length=80), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "audience = 'workflow_materialization'",
            name="ck_workflow_materialization_offer_audience",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'consumed', 'revoked')",
            name="ck_workflow_materialization_offer_status",
        ),
        sa.CheckConstraint(
            "execution_generation > 0 AND credential_generation > 0 "
            "AND workspace_generation > 0 AND executor_generation > 0",
            name="ck_workflow_materialization_offer_generations",
        ),
        sa.CheckConstraint(
            "plan_hash ~ '^sha256:[0-9a-f]{64}$' "
            "AND (accepted_binding_hash IS NULL OR "
            "accepted_binding_hash ~ '^sha256:[0-9a-f]{64}$')",
            name="ck_workflow_materialization_offer_hashes",
        ),
        sa.CheckConstraint(
            "credential_salt ~ '^[0-9a-f]{64}$' "
            "AND credential_hash ~ '^[0-9a-f]{64}$'",
            name="ck_workflow_materialization_offer_credential_digest",
        ),
        sa.CheckConstraint(
            "(status = 'pending' AND consumed_at IS NULL "
            "AND accepted_binding_hash IS NULL) OR "
            "(status = 'consumed' AND consumed_at IS NOT NULL "
            "AND accepted_binding_hash IS NOT NULL) OR "
            "(status = 'revoked' AND consumed_at IS NULL "
            "AND accepted_binding_hash IS NULL)",
            name="ck_workflow_materialization_offer_state",
        ),
        sa.ForeignKeyConstraint(
            ["workflow_run_id"], ["workflow_run.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workflow_run_id",
            "execution_generation",
            name="uq_workflow_materialization_offer_run_generation",
        ),
    )
    op.create_index(
        "ix_workflow_materialization_offer_run",
        "workflow_materialization_offer",
        ["workflow_run_id"],
    )
    op.create_index(
        "ix_workflow_materialization_offer_expires",
        "workflow_materialization_offer",
        ["expires_at"],
    )
    op.create_index(
        "uq_workflow_materialization_offer_pending_run",
        "workflow_materialization_offer",
        ["workflow_run_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )


def downgrade() -> None:
    raise RuntimeError(
        "WF-ID cutover is irreversible: legacy credentials and plaintext envelopes "
        "were revoked/purged and legacy runs were parked."
    )
