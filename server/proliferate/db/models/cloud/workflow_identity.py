"""Workflow materialization-only credential and binding-offer persistence."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class WorkflowMaterializationOffer(Base):
    """One fenced offer to materialize a run and submit its redacted binding.

    The plaintext credential is response-only. This row stores only its random
    salt and salted digest alongside the audience, TTL, and complete offer
    identity. It never stores final execution credentials.
    """

    __tablename__ = "workflow_materialization_offer"
    __table_args__ = (
        CheckConstraint(
            "audience = 'workflow_materialization'",
            name="ck_workflow_materialization_offer_audience",
        ),
        CheckConstraint(
            "status IN ('pending', 'consumed', 'revoked')",
            name="ck_workflow_materialization_offer_status",
        ),
        CheckConstraint(
            "execution_generation > 0 AND credential_generation > 0 "
            "AND workspace_generation > 0 AND executor_generation > 0",
            name="ck_workflow_materialization_offer_generations",
        ),
        CheckConstraint(
            "plan_hash ~ '^sha256:[0-9a-f]{64}$' "
            "AND (accepted_binding_hash IS NULL OR "
            "accepted_binding_hash ~ '^sha256:[0-9a-f]{64}$')",
            name="ck_workflow_materialization_offer_hashes",
        ),
        CheckConstraint(
            "credential_salt ~ '^[0-9a-f]{64}$' AND credential_hash ~ '^[0-9a-f]{64}$'",
            name="ck_workflow_materialization_offer_credential_digest",
        ),
        CheckConstraint(
            "(status = 'pending' AND consumed_at IS NULL "
            "AND accepted_binding_hash IS NULL) OR "
            "(status = 'consumed' AND consumed_at IS NOT NULL "
            "AND accepted_binding_hash IS NOT NULL) OR "
            "(status = 'revoked' AND consumed_at IS NULL "
            "AND accepted_binding_hash IS NULL)",
            name="ck_workflow_materialization_offer_state",
        ),
        UniqueConstraint(
            "workflow_run_id",
            "execution_generation",
            name="uq_workflow_materialization_offer_run_generation",
        ),
        Index(
            "uq_workflow_materialization_offer_pending_run",
            "workflow_run_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
        Index("ix_workflow_materialization_offer_run", "workflow_run_id"),
        Index("ix_workflow_materialization_offer_expires", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workflow_run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow_run.id", ondelete="CASCADE")
    )
    plan_hash: Mapped[str] = mapped_column(String(80))
    execution_generation: Mapped[int] = mapped_column(Integer)
    executor_id: Mapped[str] = mapped_column(String(255))
    executor_fence: Mapped[str] = mapped_column(String(255))
    workspace_id: Mapped[str] = mapped_column(String(255))
    workspace_generation: Mapped[int] = mapped_column(Integer)
    executor_generation: Mapped[int] = mapped_column(Integer)
    audience: Mapped[str] = mapped_column(String(64))
    credential_generation: Mapped[int] = mapped_column(Integer, default=1)
    credential_salt: Mapped[str] = mapped_column(String(64))
    credential_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default="pending")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    accepted_binding_hash: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
