"""Server-side workflow step-action claim ledger."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
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


class WorkflowStepAction(Base):
    """Exactly-once claim and at-least-once completion for server actions."""

    __tablename__ = "workflow_step_action"
    __table_args__ = (
        UniqueConstraint(
            "run_id", "step_key", "action_kind", name="uq_workflow_step_action_claim"
        ),
        CheckConstraint("action_kind IN ('slack_notify')", name="ck_workflow_step_action_kind"),
        CheckConstraint(
            "status IN ('pending', 'done', 'failed')",
            name="ck_workflow_step_action_status",
        ),
        CheckConstraint(
            "identity_schema_version = 1 AND (NOT identity_cutover_parked OR ("
            "status = 'failed' AND attempt_count >= 5))",
            name="ck_workflow_step_action_identity_writer_fence",
        ),
        Index(
            "ix_workflow_step_action_sweep",
            "updated_at",
            postgresql_where=text("status IN ('pending', 'failed')"),
        ),
    )

    # No server defaults: old action writers fail after the WF-ID cutover.
    identity_schema_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    identity_cutover_parked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workflow_run.id", ondelete="CASCADE"))
    step_key: Mapped[str] = mapped_column(String(64))
    action_kind: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    result_json: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
