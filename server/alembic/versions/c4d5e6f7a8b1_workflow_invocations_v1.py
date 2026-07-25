"""workflow invocations v1

Revision ID: c4d5e6f7a8b1
Revises: b3c4d5e6f7a9
Create Date: 2026-07-13 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c4d5e6f7a8b1"
down_revision: str | Sequence[str] | None = "b3c4d5e6f7a9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table("workflow_invocation"):
        op.create_table(
            "workflow_invocation",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("workflow_definition_id", sa.Uuid(), nullable=True),
            sa.Column("definition_revision", sa.Integer(), nullable=False),
            sa.Column("definition_schema_version", sa.Integer(), nullable=False),
            sa.Column("validated_catalog_version", sa.String(length=128), nullable=False),
            sa.Column("title_snapshot", sa.String(length=255), nullable=False),
            sa.Column("idempotency_key", sa.String(length=255), nullable=False),
            sa.Column("request_hash", sa.String(length=64), nullable=False),
            # Digest-covered documents are canonical JSON text, not JSONB:
            # JSONB normalizes numeric forms (1e21 -> 1000000000000000000000)
            # and would break digest recomputation/replay.
            sa.Column(
                "arguments_json",
                sa.Text(),
                server_default=sa.text("'{}'"),
                nullable=False,
            ),
            sa.Column(
                "resolved_bundle_json",
                sa.Text(),
                server_default=sa.text("'{}'"),
                nullable=False,
            ),
            sa.Column("bundle_digest", sa.String(length=64), nullable=False),
            sa.Column("target_kind", sa.String(length=32), nullable=False),
            sa.Column("desktop_install_id", sa.String(length=255), nullable=True),
            sa.Column(
                "logical_placement_json",
                sa.Text(),
                server_default=sa.text("'{}'"),
                nullable=False,
            ),
            sa.Column(
                "resolved_placement_json",
                sa.Text(),
                server_default=sa.text("'{}'"),
                nullable=False,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "target_kind IN ('managedCloud', 'desktop')",
                name="ck_workflow_invocation_target_kind",
            ),
            sa.CheckConstraint(
                "(target_kind = 'desktop') = (desktop_install_id IS NOT NULL)",
                name="ck_workflow_invocation_desktop_install",
            ),
            sa.CheckConstraint(
                "request_hash ~ '^[0-9a-f]{64}$'",
                name="ck_workflow_invocation_request_hash_hex",
            ),
            sa.CheckConstraint(
                "bundle_digest ~ '^[0-9a-f]{64}$'",
                name="ck_workflow_invocation_bundle_digest_hex",
            ),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["workflow_definition_id"],
                ["workflow_definition.id"],
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "user_id",
                "idempotency_key",
                name="ux_workflow_invocation_user_idempotency_key",
            ),
        )
        op.create_index(
            "ix_workflow_invocation_user_created",
            "workflow_invocation",
            ["user_id", "created_at", "id"],
        )
        op.create_index(
            "ix_workflow_invocation_definition_id",
            "workflow_invocation",
            ["workflow_definition_id"],
        )

    if not _has_table("workflow_invocation_delivery"):
        op.create_table(
            "workflow_invocation_delivery",
            sa.Column("invocation_id", sa.Uuid(), nullable=False),
            sa.Column(
                "status",
                sa.String(length=32),
                server_default=sa.text("'queued'"),
                nullable=False,
            ),
            sa.Column("cloud_sandbox_id", sa.String(length=255), nullable=True),
            sa.Column("handoff_started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "attempt_count",
                sa.Integer(),
                server_default=sa.text("0"),
                nullable=False,
            ),
            sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
            # Canonical JSON text (digest-covered), not JSONB.
            sa.Column("runtime_payload_json", sa.Text(), nullable=True),
            sa.Column("runtime_payload_digest", sa.String(length=64), nullable=True),
            sa.Column("anyharness_run_id", sa.String(length=64), nullable=True),
            sa.Column("anyharness_workspace_id", sa.String(length=64), nullable=True),
            sa.Column("anyharness_data_epoch", sa.String(length=128), nullable=True),
            sa.Column("runtime_revision", sa.BigInteger(), nullable=True),
            sa.Column(
                "runtime_observation_json",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=True,
            ),
            sa.Column("runtime_observed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("control_plane_runtime_outcome", sa.String(length=32), nullable=True),
            sa.Column(
                "control_plane_runtime_outcome_at",
                sa.DateTime(timezone=True),
                nullable=True,
            ),
            sa.Column(
                "control_plane_runtime_outcome_reason",
                sa.String(length=64),
                nullable=True,
            ),
            sa.Column("cancel_requested_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("error_code", sa.String(length=128), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "status IN ('queued', 'delivering', 'accepted', 'failed', 'cancelled')",
                name="ck_workflow_invocation_delivery_status",
            ),
            sa.CheckConstraint(
                "control_plane_runtime_outcome IS NULL"
                " OR control_plane_runtime_outcome = 'runtime_lost'",
                name="ck_workflow_invocation_delivery_runtime_outcome",
            ),
            sa.CheckConstraint(
                "status <> 'queued' OR handoff_started_at IS NULL",
                name="ck_wf_delivery_queued_unoffered",
            ),
            sa.CheckConstraint(
                "status NOT IN ('delivering', 'accepted') OR handoff_started_at IS NOT NULL",
                name="ck_wf_delivery_offered_has_handoff",
            ),
            sa.CheckConstraint(
                "status <> 'accepted' OR (accepted_at IS NOT NULL"
                " AND anyharness_run_id IS NOT NULL"
                " AND runtime_payload_digest IS NOT NULL)",
                name="ck_wf_delivery_accepted_custody",
            ),
            sa.CheckConstraint(
                "status NOT IN ('failed', 'cancelled') OR finished_at IS NOT NULL",
                name="ck_wf_delivery_terminal_finished",
            ),
            sa.CheckConstraint(
                "status <> 'failed' OR (error_code IS NOT NULL AND cancel_requested_at IS NULL)",
                name="ck_wf_delivery_failed_deterministic",
            ),
            sa.CheckConstraint(
                "status <> 'cancelled' OR cancel_requested_at IS NOT NULL",
                name="ck_wf_delivery_cancelled_has_marker",
            ),
            sa.CheckConstraint(
                "status <> 'cancelled' OR (handoff_started_at IS NULL"
                " AND runtime_payload_digest IS NULL"
                " AND anyharness_run_id IS NULL"
                " AND anyharness_workspace_id IS NULL"
                " AND runtime_revision IS NULL"
                " AND accepted_at IS NULL"
                " AND control_plane_runtime_outcome IS NULL)",
                name="ck_wf_delivery_cancelled_unoffered",
            ),
            sa.CheckConstraint(
                "anyharness_run_id IS NULL OR anyharness_run_id = invocation_id::text",
                name="ck_wf_delivery_run_binding",
            ),
            sa.CheckConstraint(
                "(runtime_payload_digest IS NULL) = (runtime_payload_json IS NULL)"
                " AND (runtime_payload_digest IS NULL) = (anyharness_data_epoch IS NULL)",
                name="ck_wf_delivery_payload_paired",
            ),
            sa.CheckConstraint(
                "runtime_payload_digest IS NULL OR runtime_payload_digest ~ '^[0-9a-f]{64}$'",
                name="ck_wf_delivery_payload_digest_hex",
            ),
            sa.CheckConstraint(
                "(runtime_revision IS NULL) = (runtime_observation_json IS NULL)"
                " AND (runtime_revision IS NULL) = (runtime_observed_at IS NULL)",
                name="ck_wf_delivery_projection_paired",
            ),
            sa.CheckConstraint(
                "runtime_revision IS NULL OR runtime_revision >= 1",
                name="ck_wf_delivery_projection_revision",
            ),
            sa.CheckConstraint(
                "runtime_revision IS NULL OR status = 'accepted'",
                name="ck_wf_delivery_projection_accepted",
            ),
            sa.CheckConstraint(
                "(control_plane_runtime_outcome IS NULL)"
                " = (control_plane_runtime_outcome_at IS NULL)"
                " AND (control_plane_runtime_outcome IS NULL)"
                " = (control_plane_runtime_outcome_reason IS NULL)",
                name="ck_wf_delivery_outcome_paired",
            ),
            sa.CheckConstraint(
                "control_plane_runtime_outcome IS NULL"
                " OR (handoff_started_at IS NOT NULL AND anyharness_data_epoch IS NOT NULL)",
                name="ck_wf_delivery_outcome_needs_handoff",
            ),
            sa.CheckConstraint(
                "control_plane_runtime_outcome_reason IS NULL"
                " OR control_plane_runtime_outcome_reason IN"
                " ('epoch_changed', 'accepted_run_absent', 'sandbox_destroyed')",
                name="ck_wf_delivery_lost_reason_shape",
            ),
            sa.CheckConstraint(
                "control_plane_runtime_outcome IS NULL OR status IN ('delivering', 'accepted')",
                name="ck_wf_delivery_lost_live_status",
            ),
            sa.CheckConstraint(
                "control_plane_runtime_outcome_reason <> 'accepted_run_absent'"
                " OR (status = 'accepted' AND anyharness_run_id IS NOT NULL)",
                name="ck_wf_delivery_lost_run_absent_proof",
            ),
            sa.CheckConstraint(
                "control_plane_runtime_outcome_reason <> 'sandbox_destroyed'"
                " OR cloud_sandbox_id IS NOT NULL",
                name="ck_wf_delivery_lost_sandbox_proof",
            ),
            sa.ForeignKeyConstraint(
                ["invocation_id"],
                ["workflow_invocation.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("invocation_id"),
        )
        op.create_index(
            "ix_workflow_invocation_delivery_status",
            "workflow_invocation_delivery",
            ["status"],
        )


def downgrade() -> None:
    if _has_table("workflow_invocation_delivery"):
        op.drop_table("workflow_invocation_delivery")
    if _has_table("workflow_invocation"):
        op.drop_table("workflow_invocation")
