"""Workflow definition and invocation persistence models."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class WorkflowDefinition(Base):
    __tablename__ = "workflow_definition"
    __table_args__ = (
        CheckConstraint(
            "schema_version = 1",
            name="ck_workflow_definition_schema_version",
        ),
        CheckConstraint(
            "revision >= 1",
            name="ck_workflow_definition_revision",
        ),
        Index(
            "ix_workflow_definition_user_updated",
            "user_id",
            "updated_at",
            "id",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "ix_workflow_definition_default_repo_config_id",
            "default_repo_config_id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
    )
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(
        Text,
        default="",
        server_default=text("''"),
    )
    schema_version: Mapped[int] = mapped_column(
        Integer,
        default=1,
        server_default=text("1"),
    )
    revision: Mapped[int] = mapped_column(
        Integer,
        default=1,
        server_default=text("1"),
    )
    validated_catalog_version: Mapped[str] = mapped_column(String(128))
    default_repo_config_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("repo_config.id", ondelete="SET NULL"),
        nullable=True,
    )
    inputs_json: Mapped[list[dict[str, object]]] = mapped_column(
        JSONB,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    stages_json: Mapped[list[dict[str, object]]] = mapped_column(
        JSONB,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WorkflowInvocation(Base):
    """Immutable record of one workflow run request (PR2 design §7.1).

    Every column is written once at creation; there is no update path. The
    definition snapshot, arguments, frozen placement, and resolved bundle are
    retained so later definition edits or deletions can never redirect the
    run.
    """

    __tablename__ = "workflow_invocation"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "idempotency_key",
            name="ux_workflow_invocation_user_idempotency_key",
        ),
        CheckConstraint(
            "target_kind IN ('managedCloud', 'desktop')",
            name="ck_workflow_invocation_target_kind",
        ),
        CheckConstraint(
            "(target_kind = 'desktop') = (desktop_install_id IS NOT NULL)",
            name="ck_workflow_invocation_desktop_install",
        ),
        # SHA-256 digests are lowercase 64-hex everywhere in the contract; a
        # differently cased or truncated digest would silently break every
        # exact-custody CAS comparing against these columns.
        CheckConstraint(
            "request_hash ~ '^[0-9a-f]{64}$'",
            name="ck_workflow_invocation_request_hash_hex",
        ),
        CheckConstraint(
            "bundle_digest ~ '^[0-9a-f]{64}$'",
            name="ck_workflow_invocation_bundle_digest_hex",
        ),
        Index(
            "ix_workflow_invocation_user_created",
            "user_id",
            "created_at",
            "id",
        ),
        Index(
            "ix_workflow_invocation_definition_id",
            "workflow_definition_id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
    )
    workflow_definition_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workflow_definition.id", ondelete="SET NULL"),
        nullable=True,
    )
    definition_revision: Mapped[int] = mapped_column(Integer)
    definition_schema_version: Mapped[int] = mapped_column(Integer)
    validated_catalog_version: Mapped[str] = mapped_column(String(128))
    title_snapshot: Mapped[str] = mapped_column(String(255))
    idempotency_key: Mapped[str] = mapped_column(String(255))
    request_hash: Mapped[str] = mapped_column(String(64))
    # Digest-covered documents are stored as RFC 8785 canonical JSON *text*,
    # not JSONB: Postgres JSONB normalizes numeric forms (1e21 reloads as the
    # integer 1000000000000000000000), which breaks digest recomputation and
    # replay for exponent-form values.
    arguments_json: Mapped[str] = mapped_column(
        Text,
        default="{}",
        server_default=text("'{}'"),
    )
    resolved_bundle_json: Mapped[str] = mapped_column(
        Text,
        default="{}",
        server_default=text("'{}'"),
    )
    bundle_digest: Mapped[str] = mapped_column(String(64))
    target_kind: Mapped[str] = mapped_column(String(32))
    desktop_install_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    logical_placement_json: Mapped[str] = mapped_column(
        Text,
        default="{}",
        server_default=text("'{}'"),
    )
    resolved_placement_json: Mapped[str] = mapped_column(
        Text,
        default="{}",
        server_default=text("'{}'"),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WorkflowInvocationDelivery(Base):
    """Mutable delivery state for one invocation (PR2 design §7.2).

    Progress is monotonic: `accepted` and cancellation-pending state can never
    be overwritten by a late failure, and the runtime projection only stores
    strictly greater revisions. Delivery status and runtime status are
    separate — `accepted` means AnyHarness durably owns the run, not that the
    run finished.
    """

    __tablename__ = "workflow_invocation_delivery"
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'delivering', 'accepted', 'failed', 'cancelled')",
            name="ck_workflow_invocation_delivery_status",
        ),
        CheckConstraint(
            "control_plane_runtime_outcome IS NULL"
            " OR control_plane_runtime_outcome = 'runtime_lost'",
            name="ck_workflow_invocation_delivery_runtime_outcome",
        ),
        # Paired-field and status invariants (PR2 design §7.2): the database
        # is the last fence against a buggy or replayed writer recording
        # acceptance without custody evidence or a terminal state without its
        # markers.
        CheckConstraint(
            "status <> 'queued' OR handoff_started_at IS NULL",
            name="ck_wf_delivery_queued_unoffered",
        ),
        CheckConstraint(
            "status NOT IN ('delivering', 'accepted') OR handoff_started_at IS NOT NULL",
            name="ck_wf_delivery_offered_has_handoff",
        ),
        CheckConstraint(
            "status <> 'accepted' OR (accepted_at IS NOT NULL"
            " AND anyharness_run_id IS NOT NULL"
            " AND runtime_payload_digest IS NOT NULL)",
            name="ck_wf_delivery_accepted_custody",
        ),
        CheckConstraint(
            "status NOT IN ('failed', 'cancelled') OR finished_at IS NOT NULL",
            name="ck_wf_delivery_terminal_finished",
        ),
        CheckConstraint(
            "status <> 'failed' OR (error_code IS NOT NULL AND cancel_requested_at IS NULL)",
            name="ck_wf_delivery_failed_deterministic",
        ),
        CheckConstraint(
            "status <> 'cancelled' OR cancel_requested_at IS NOT NULL",
            name="ck_wf_delivery_cancelled_has_marker",
        ),
        # Only a queued row that provably never left Cloud may cancel locally
        # (design §16): once handoff evidence exists, cancellation converges
        # at the target and the row stays delivering/accepted. An unoffered
        # row can never have acquired custody, so every custody field must be
        # absent on a cancelled row.
        CheckConstraint(
            "status <> 'cancelled' OR (handoff_started_at IS NULL"
            " AND runtime_payload_digest IS NULL"
            " AND anyharness_run_id IS NULL"
            " AND anyharness_workspace_id IS NULL"
            " AND runtime_revision IS NULL"
            " AND accepted_at IS NULL"
            " AND control_plane_runtime_outcome IS NULL)",
            name="ck_wf_delivery_cancelled_unoffered",
        ),
        # The AnyHarness run ID is the bundle runId, which is the invocation
        # ID (design §6.3): a result for a different run can never bind here.
        CheckConstraint(
            "anyharness_run_id IS NULL OR anyharness_run_id = invocation_id::text",
            name="ck_wf_delivery_run_binding",
        ),
        CheckConstraint(
            "(runtime_payload_digest IS NULL) = (runtime_payload_json IS NULL)"
            " AND (runtime_payload_digest IS NULL) = (anyharness_data_epoch IS NULL)",
            name="ck_wf_delivery_payload_paired",
        ),
        CheckConstraint(
            "runtime_payload_digest IS NULL OR runtime_payload_digest ~ '^[0-9a-f]{64}$'",
            name="ck_wf_delivery_payload_digest_hex",
        ),
        CheckConstraint(
            "(runtime_revision IS NULL) = (runtime_observation_json IS NULL)"
            " AND (runtime_revision IS NULL) = (runtime_observed_at IS NULL)",
            name="ck_wf_delivery_projection_paired",
        ),
        # AnyHarness run revisions are monotonic starting at 1 (design §10.1),
        # and projections bind only to an accepted run's custody.
        CheckConstraint(
            "runtime_revision IS NULL OR runtime_revision >= 1",
            name="ck_wf_delivery_projection_revision",
        ),
        CheckConstraint(
            "runtime_revision IS NULL OR status = 'accepted'",
            name="ck_wf_delivery_projection_accepted",
        ),
        CheckConstraint(
            "(control_plane_runtime_outcome IS NULL)"
            " = (control_plane_runtime_outcome_at IS NULL)"
            " AND (control_plane_runtime_outcome IS NULL)"
            " = (control_plane_runtime_outcome_reason IS NULL)",
            name="ck_wf_delivery_outcome_paired",
        ),
        CheckConstraint(
            "control_plane_runtime_outcome IS NULL"
            " OR (handoff_started_at IS NOT NULL AND anyharness_data_epoch IS NOT NULL)",
            name="ck_wf_delivery_outcome_needs_handoff",
        ),
        # Loss is proof-specific (design §8.3): the reason enum is closed,
        # loss never regresses delivery status, an absent-run proof exists
        # only for an accepted run, and sandbox destruction only for a row
        # bound to its exact managed sandbox.
        CheckConstraint(
            "control_plane_runtime_outcome_reason IS NULL"
            " OR control_plane_runtime_outcome_reason IN"
            " ('epoch_changed', 'accepted_run_absent', 'sandbox_destroyed')",
            name="ck_wf_delivery_lost_reason_shape",
        ),
        CheckConstraint(
            "control_plane_runtime_outcome IS NULL OR status IN ('delivering', 'accepted')",
            name="ck_wf_delivery_lost_live_status",
        ),
        CheckConstraint(
            "control_plane_runtime_outcome_reason <> 'accepted_run_absent'"
            " OR (status = 'accepted' AND anyharness_run_id IS NOT NULL)",
            name="ck_wf_delivery_lost_run_absent_proof",
        ),
        CheckConstraint(
            "control_plane_runtime_outcome_reason <> 'sandbox_destroyed'"
            " OR cloud_sandbox_id IS NOT NULL",
            name="ck_wf_delivery_lost_sandbox_proof",
        ),
        Index(
            "ix_workflow_invocation_delivery_status",
            "status",
        ),
    )

    invocation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow_invocation.id", ondelete="CASCADE"),
        primary_key=True,
    )
    status: Mapped[str] = mapped_column(
        String(32),
        default="queued",
        server_default=text("'queued'"),
    )
    cloud_sandbox_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    handoff_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Target handoff evidence, not a broker retry count.
    attempt_count: Mapped[int] = mapped_column(
        Integer,
        default=0,
        server_default=text("0"),
    )
    last_attempt_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Canonical JSON text, not JSONB — the digest must recompute byte-equal
    # (see the workflow_invocation column comment).
    runtime_payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    runtime_payload_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    anyharness_run_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    anyharness_workspace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Fixed before the first possible target handoff.
    anyharness_data_epoch: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # AnyHarness revisions are SQLite i64; the projection CAS compares them.
    runtime_revision: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    runtime_observation_json: Mapped[dict[str, object] | None] = mapped_column(
        JSONB, nullable=True
    )
    runtime_observed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    control_plane_runtime_outcome: Mapped[str | None] = mapped_column(String(32), nullable=True)
    control_plane_runtime_outcome_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # The §8.3 proof that justified `runtime_lost`: epoch_changed,
    # accepted_run_absent, or sandbox_destroyed.
    control_plane_runtime_outcome_reason: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )
    cancel_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
