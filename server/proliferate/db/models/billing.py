"""Billing-domain ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class BillingSubject(Base):
    __tablename__ = "billing_subject"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(unique=True, index=True, nullable=True)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class BillingHold(Base):
    __tablename__ = "billing_hold"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    billing_subject_id: Mapped[uuid.UUID] = mapped_column(index=True)
    kind: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    source: Mapped[str] = mapped_column(String(64))
    source_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class BillingDecisionEvent(Base):
    __tablename__ = "billing_decision_event"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    billing_subject_id: Mapped[uuid.UUID] = mapped_column(index=True)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    decision_type: Mapped[str] = mapped_column(String(64), index=True)
    mode: Mapped[str] = mapped_column(String(32), index=True)
    would_block_start: Mapped[bool] = mapped_column(Boolean, default=False)
    would_pause_active: Mapped[bool] = mapped_column(Boolean, default=False)
    reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    active_sandbox_count: Mapped[int] = mapped_column(default=0)
    remaining_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class BillingGrant(Base):
    __tablename__ = "billing_grant"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    billing_subject_id: Mapped[uuid.UUID] = mapped_column(index=True)
    grant_type: Mapped[str] = mapped_column(String(64))
    hours_granted: Mapped[float] = mapped_column(Float)
    effective_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source_ref: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class BillingEntitlement(Base):
    __tablename__ = "billing_entitlement"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    billing_subject_id: Mapped[uuid.UUID] = mapped_column(index=True)
    kind: Mapped[str] = mapped_column(String(64))
    effective_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class UsageSegment(Base):
    __tablename__ = "usage_segment"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    billing_subject_id: Mapped[uuid.UUID] = mapped_column(index=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(index=True)
    sandbox_id: Mapped[uuid.UUID] = mapped_column(index=True)
    external_sandbox_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    sandbox_execution_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_billable: Mapped[bool] = mapped_column(Boolean, default=True)
    opened_by: Mapped[str] = mapped_column(String(64))
    closed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class SandboxEventReceipt(Base):
    __tablename__ = "sandbox_event_receipt"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[str] = mapped_column(String(255), unique=True)
    provider: Mapped[str] = mapped_column(String(32))
    event_type: Mapped[str] = mapped_column(String(64))
    external_sandbox_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
