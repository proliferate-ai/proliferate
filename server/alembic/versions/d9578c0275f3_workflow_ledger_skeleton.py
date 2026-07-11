"""WS2a workflow ledger persistence skeleton (completion plan §6 WS2a).

Revision ID: d9578c0275f3
Revises: c3f8b1d6a4e2
Create Date: 2026-07-10 12:00:00.000000

ADD-ONLY skeleton for the workflows target contract
(specs/codebase/features/workflows.md §5.2-§5.4, §7, §8, §10). No behavioral
cutover: existing code keeps running against the existing columns/tables;
nothing reads or writes the new surface yet except WS2a's own tier-1 tests.

1. ``workflow_run``: split state axes (desired/delivery/observed +
   quiescence/execution-health/pre-acceptance-cancel, all nullable, each with a
   NULL-permitting CHECK), observation CAS pair (``observed_revision`` +
   ``observed_snapshot_json``), and the immutable delivery-identity fields
   (``plan_hash``, ``binding_hash``, ``execution_generation``, ``plan_version``,
   redacted ``execution_binding_json``).
2. ``workflow_trigger``: ``poll_cursor_generation`` CAS fence for §10.3.
3. Seven new tables: ``workflow_run_outbox``, ``workflow_control_command``,
   ``workflow_capability_lease``, ``workflow_gateway_receipt``,
   ``workflow_poll_inbox``, ``workflow_session_lease`` (with THE §8.2 partial
   unique index on session_id over non-released states), and
   ``workflow_action_effect``.

Forward-only; idempotent-guarded like the rest of the workflow chain so a
re-run is a genuine no-op against a populated pre-feature database.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d9578c0275f3"
down_revision: str | Sequence[str] | None = "c3f8b1d6a4e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _inspector() -> sa.engine.reflection.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in set(_inspector().get_table_names())


def _has_column(table_name: str, column_name: str) -> bool:
    return column_name in {col["name"] for col in _inspector().get_columns(table_name)}


def _has_constraint(table_name: str, constraint_name: str) -> bool:
    names = {ck["name"] for ck in _inspector().get_check_constraints(table_name)}
    return constraint_name in names


# --- workflow_run: state axes + delivery identity (spec §8.1, §5.2/§5.3/§5.4) ----

_RUN_AXIS_COLUMNS: tuple[tuple[str, sa.types.TypeEngine], ...] = (
    ("desired_state", sa.String(length=32)),
    ("delivery_state", sa.String(length=32)),
    ("observed_state", sa.String(length=32)),
    ("observed_quiescence_state", sa.String(length=32)),
    ("execution_health", sa.String(length=32)),
    ("preaccept_cancel_state", sa.String(length=32)),
    ("observed_revision", sa.BigInteger()),
    ("observed_snapshot_json", JSONB()),
    ("plan_hash", sa.String(length=80)),
    ("binding_hash", sa.String(length=80)),
    ("execution_generation", sa.Integer()),
    ("plan_version", sa.Integer()),
    ("execution_binding_json", JSONB()),
)

_RUN_AXIS_CHECKS: tuple[tuple[str, str], ...] = (
    (
        "ck_workflow_run_desired_state",
        "desired_state IS NULL OR desired_state IN ('running', 'cancel_requested')",
    ),
    (
        "ck_workflow_run_delivery_state",
        "delivery_state IS NULL OR delivery_state IN ("
        "'ready', 'claimed', 'materializing', 'delivered', 'acknowledged', "
        "'retryable_ready', 'terminal_delivery_failure')",
    ),
    (
        "ck_workflow_run_observed_state",
        "observed_state IS NULL OR observed_state IN ("
        "'accepted', 'running', 'completed', 'failed', 'quiescing', 'cancelled', "
        "'waiting_action_result', 'waiting_credential_refresh')",
    ),
    (
        "ck_workflow_run_execution_health",
        "execution_health IS NULL OR execution_health IN ('healthy', 'suspect', 'orphaned')",
    ),
    (
        "ck_workflow_run_preaccept_cancel_state",
        "preaccept_cancel_state IS NULL OR preaccept_cancel_state IN ("
        "'none', 'cancelling_preaccept', 'cancelled_before_acceptance')",
    ),
)


def upgrade() -> None:
    # 1. workflow_run state axes + delivery identity (ADD-ONLY, all nullable).
    for name, column_type in _RUN_AXIS_COLUMNS:
        if not _has_column("workflow_run", name):
            op.add_column("workflow_run", sa.Column(name, column_type, nullable=True))
    for ck_name, ck_sql in _RUN_AXIS_CHECKS:
        if not _has_constraint("workflow_run", ck_name):
            op.create_check_constraint(ck_name, "workflow_run", ck_sql)

    # 2. workflow_trigger poll-cursor CAS fence (spec §10.3).
    if not _has_column("workflow_trigger", "poll_cursor_generation"):
        op.add_column(
            "workflow_trigger",
            sa.Column("poll_cursor_generation", sa.BigInteger(), nullable=True),
        )

    # 3. workflow_run_outbox (spec §6 WF-6, §10.2).
    if not _has_table("workflow_run_outbox"):
        op.create_table(
            "workflow_run_outbox",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column(
                "run_id",
                sa.Uuid(),
                sa.ForeignKey("workflow_run.id", ondelete="CASCADE"),
                nullable=True,
            ),
            sa.Column(
                "trigger_id",
                sa.Uuid(),
                sa.ForeignKey("workflow_trigger.id", ondelete="CASCADE"),
                nullable=True,
            ),
            sa.Column("kind", sa.String(length=64), nullable=False),
            sa.Column("payload_json", JSONB(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("attempt_count", sa.Integer(), nullable=False),
            sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "status IN ('pending', 'delivering', 'delivered', 'failed')",
                name="ck_workflow_run_outbox_status",
            ),
            sa.CheckConstraint(
                "run_id IS NOT NULL OR trigger_id IS NOT NULL",
                name="ck_workflow_run_outbox_subject",
            ),
        )
        op.create_index(
            "ix_workflow_run_outbox_due",
            "workflow_run_outbox",
            ["next_attempt_at", "created_at", "id"],
            postgresql_where=sa.text("status = 'pending'"),
        )
        op.create_index("ix_workflow_run_outbox_run_id", "workflow_run_outbox", ["run_id"])
        op.create_index("ix_workflow_run_outbox_trigger_id", "workflow_run_outbox", ["trigger_id"])

    # 4. workflow_control_command (spec §8.3).
    if not _has_table("workflow_control_command"):
        op.create_table(
            "workflow_control_command",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column(
                "run_id",
                sa.Uuid(),
                sa.ForeignKey("workflow_run.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("kind", sa.String(length=32), nullable=False),
            sa.Column("reason", sa.String(length=255), nullable=True),
            sa.Column("plan_hash", sa.String(length=80), nullable=True),
            sa.Column("binding_hash", sa.String(length=80), nullable=True),
            sa.Column("execution_generation", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("ack_outcome", sa.String(length=64), nullable=True),
            sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint("kind IN ('cancel')", name="ck_workflow_control_command_kind"),
            sa.CheckConstraint(
                "status IN ('pending', 'delivered', 'acknowledged', 'superseded')",
                name="ck_workflow_control_command_status",
            ),
        )
        op.create_index(
            "ix_workflow_control_command_pending",
            "workflow_control_command",
            ["run_id", "created_at"],
            postgresql_where=sa.text("status IN ('pending', 'delivered')"),
        )
        op.create_index(
            "ix_workflow_control_command_run_id", "workflow_control_command", ["run_id"]
        )

    # 5. workflow_capability_lease (spec §7.1 CapabilityRef, frozen at StartRun).
    if not _has_table("workflow_capability_lease"):
        op.create_table(
            "workflow_capability_lease",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column(
                "run_id",
                sa.Uuid(),
                sa.ForeignKey("workflow_run.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("slot_id", sa.String(length=64), nullable=False),
            sa.Column("kind", sa.String(length=32), nullable=False),
            sa.Column("capability_key", sa.String(length=255), nullable=False),
            sa.Column("plan_hash", sa.String(length=80), nullable=True),
            sa.Column("provider_definition_id", sa.String(length=255), nullable=True),
            sa.Column("provider_revision", sa.String(length=255), nullable=True),
            sa.Column("tool_name", sa.String(length=255), nullable=True),
            sa.Column("input_schema_hash", sa.String(length=80), nullable=True),
            sa.Column("function_definition_id", sa.String(length=255), nullable=True),
            sa.Column("semantic_revision", sa.Integer(), nullable=True),
            sa.Column("product_mcp_definition", sa.String(length=64), nullable=True),
            sa.Column("policy_revision", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "kind IN ('integration_tool', 'function', 'product_mcp')",
                name="ck_workflow_capability_lease_kind",
            ),
            sa.UniqueConstraint(
                "run_id",
                "slot_id",
                "capability_key",
                name="uq_workflow_capability_lease_run_slot_key",
            ),
        )
        op.create_index(
            "ix_workflow_capability_lease_run_id", "workflow_capability_lease", ["run_id"]
        )

    # 6. workflow_gateway_receipt (spec §7.3).
    if not _has_table("workflow_gateway_receipt"):
        op.create_table(
            "workflow_gateway_receipt",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column(
                "run_id",
                sa.Uuid(),
                sa.ForeignKey("workflow_run.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("plan_hash", sa.String(length=80), nullable=False),
            sa.Column("slot_id", sa.String(length=64), nullable=False),
            sa.Column("session_id", sa.String(length=255), nullable=False),
            sa.Column("step_key", sa.String(length=255), nullable=False),
            sa.Column("attempt", sa.Integer(), nullable=False),
            sa.Column("turn_id", sa.String(length=255), nullable=True),
            sa.Column("activation_id", sa.String(length=255), nullable=False),
            sa.Column("capability_kind", sa.String(length=32), nullable=False),
            sa.Column("provider_definition_id", sa.String(length=255), nullable=True),
            sa.Column("provider_revision", sa.String(length=255), nullable=True),
            sa.Column("tool_name", sa.String(length=255), nullable=True),
            sa.Column("input_schema_hash", sa.String(length=80), nullable=True),
            sa.Column("function_definition_id", sa.String(length=255), nullable=True),
            sa.Column("semantic_revision", sa.Integer(), nullable=True),
            sa.Column("authorization_decision", sa.String(length=16), nullable=False),
            sa.Column("outcome", sa.String(length=32), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(
                "capability_kind IN ('integration_tool', 'function')",
                name="ck_workflow_gateway_receipt_capability_kind",
            ),
            sa.CheckConstraint(
                "authorization_decision IN ('allow', 'deny')",
                name="ck_workflow_gateway_receipt_decision",
            ),
            sa.CheckConstraint(
                "outcome IN ('success', 'denied', 'upstream_failed', 'output_invalid')",
                name="ck_workflow_gateway_receipt_outcome",
            ),
            sa.UniqueConstraint("activation_id", name="uq_workflow_gateway_receipt_activation"),
        )
        op.create_index(
            "ix_workflow_gateway_receipt_run_id", "workflow_gateway_receipt", ["run_id"]
        )
        op.create_index(
            "ix_workflow_gateway_receipt_run_step_attempt",
            "workflow_gateway_receipt",
            ["run_id", "step_key", "attempt"],
        )

    # 7. workflow_poll_inbox (spec §10.3).
    if not _has_table("workflow_poll_inbox"):
        op.create_table(
            "workflow_poll_inbox",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column(
                "trigger_id",
                sa.Uuid(),
                sa.ForeignKey("workflow_trigger.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("external_item_id", sa.String(length=255), nullable=False),
            sa.Column("payload_json", JSONB(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("attempt_count", sa.Integer(), nullable=False),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column(
                "run_id",
                sa.Uuid(),
                sa.ForeignKey("workflow_run.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "status IN ('pending', 'scheduled', 'duplicate', 'dead_letter')",
                name="ck_workflow_poll_inbox_status",
            ),
            sa.UniqueConstraint(
                "trigger_id", "external_item_id", name="uq_workflow_poll_inbox_trigger_item"
            ),
        )
        op.create_index(
            "ix_workflow_poll_inbox_retry",
            "workflow_poll_inbox",
            ["updated_at"],
            postgresql_where=sa.text("status = 'pending'"),
        )

    # 8. workflow_session_lease (spec §8.2, with THE partial unique index).
    if not _has_table("workflow_session_lease"):
        op.create_table(
            "workflow_session_lease",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("session_id", sa.String(length=255), nullable=False),
            sa.Column(
                "run_id",
                sa.Uuid(),
                sa.ForeignKey("workflow_run.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("slot_id", sa.String(length=64), nullable=True),
            sa.Column("state", sa.String(length=32), nullable=False),
            sa.Column("generation", sa.BigInteger(), nullable=False),
            sa.Column("reserved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("prepared_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "state IN ("
                "'available', 'reserved', 'prepared', 'claimed', 'quiescing', "
                "'released', 'orphaned')",
                name="ck_workflow_session_lease_state",
            ),
        )
        op.create_index(
            "uq_workflow_session_lease_active",
            "workflow_session_lease",
            ["session_id"],
            unique=True,
            postgresql_where=sa.text(
                "state IN ('reserved', 'prepared', 'claimed', 'quiescing', 'orphaned')"
            ),
        )
        op.create_index("ix_workflow_session_lease_run_id", "workflow_session_lease", ["run_id"])
        op.create_index(
            "ix_workflow_session_lease_session_id", "workflow_session_lease", ["session_id"]
        )

    # 9. workflow_action_effect (spec §7.4).
    if not _has_table("workflow_action_effect"):
        op.create_table(
            "workflow_action_effect",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column(
                "run_id",
                sa.Uuid(),
                sa.ForeignKey("workflow_run.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("step_key", sa.String(length=255), nullable=False),
            sa.Column("attempt", sa.Integer(), nullable=False),
            sa.Column("action_kind", sa.String(length=32), nullable=False),
            sa.Column("payload_json", JSONB(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("provider_operation_id", sa.String(length=255), nullable=True),
            sa.Column("provider_message_id", sa.String(length=255), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "action_kind IN ('slack_notify')", name="ck_workflow_action_effect_kind"
            ),
            sa.CheckConstraint(
                "status IN ('pending', 'running', 'completed', 'failed', 'outcome_uncertain')",
                name="ck_workflow_action_effect_status",
            ),
            sa.UniqueConstraint(
                "run_id", "step_key", "attempt", name="uq_workflow_action_effect_identity"
            ),
        )
        op.create_index(
            "ix_workflow_action_effect_sweep",
            "workflow_action_effect",
            ["updated_at"],
            postgresql_where=sa.text("status IN ('pending', 'running', 'failed')"),
        )


def downgrade() -> None:
    for table_name in (
        "workflow_action_effect",
        "workflow_session_lease",
        "workflow_poll_inbox",
        "workflow_gateway_receipt",
        "workflow_capability_lease",
        "workflow_control_command",
        "workflow_run_outbox",
    ):
        if _has_table(table_name):
            op.drop_table(table_name)

    if _has_column("workflow_trigger", "poll_cursor_generation"):
        op.drop_column("workflow_trigger", "poll_cursor_generation")

    for ck_name, _ck_sql in _RUN_AXIS_CHECKS:
        if _has_constraint("workflow_run", ck_name):
            op.drop_constraint(ck_name, "workflow_run", type_="check")
    for name, _column_type in reversed(_RUN_AXIS_COLUMNS):
        if _has_column("workflow_run", name):
            op.drop_column("workflow_run", name)
