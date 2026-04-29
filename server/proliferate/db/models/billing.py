"""Billing-domain ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class BillingSubject(Base):
    __tablename__ = "billing_subject"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(unique=True, index=True, nullable=True)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    stripe_customer_id: Mapped[str | None] = mapped_column(
        String(255),
        unique=True,
        nullable=True,
    )
    overage_enabled: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default=text("false"),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class BillingSubscription(Base):
    __tablename__ = "billing_subscription"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    billing_subject_id: Mapped[uuid.UUID] = mapped_column(index=True)
    stripe_subscription_id: Mapped[str] = mapped_column(String(255), unique=True)
    stripe_customer_id: Mapped[str] = mapped_column(String(255), index=True)
    status: Mapped[str] = mapped_column(String(64), index=True)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False)
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    current_period_start: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    current_period_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    cloud_monthly_price_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    overage_price_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    monthly_subscription_item_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    metered_subscription_item_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    latest_invoice_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    latest_invoice_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    hosted_invoice_url: Mapped[str | None] = mapped_column(Text, nullable=True)
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
    remaining_seconds: Mapped[float] = mapped_column(Float)
    effective_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source_ref: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class BillingGrantConsumption(Base):
    __tablename__ = "billing_grant_consumption"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    billing_subject_id: Mapped[uuid.UUID] = mapped_column(index=True)
    billing_grant_id: Mapped[uuid.UUID] = mapped_column(index=True)
    usage_segment_id: Mapped[uuid.UUID] = mapped_column(index=True)
    accounted_from: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accounted_until: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    seconds: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class BillingUsageCursor(Base):
    __tablename__ = "billing_usage_cursor"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    billing_subject_id: Mapped[uuid.UUID] = mapped_column(index=True)
    usage_segment_id: Mapped[uuid.UUID] = mapped_column(unique=True, index=True)
    accounted_until: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class BillingUsageExport(Base):
    __tablename__ = "billing_usage_export"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    billing_subject_id: Mapped[uuid.UUID] = mapped_column(index=True)
    billing_subscription_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    usage_segment_id: Mapped[uuid.UUID] = mapped_column(index=True)
    period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    accounted_from: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accounted_until: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    quantity_seconds: Mapped[float] = mapped_column(Float)
    idempotency_key: Mapped[str] = mapped_column(String(255), unique=True)
    stripe_meter_event_identifier: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(64), index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
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


class WebhookEventReceipt(Base):
    __tablename__ = "webhook_event_receipt"
    __table_args__ = (
        UniqueConstraint(
            "provider",
            "event_id",
            name="uq_webhook_event_receipt_provider_event_id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[str] = mapped_column(String(255))
    provider: Mapped[str] = mapped_column(String(32))
    event_type: Mapped[str] = mapped_column(String(64))
    external_sandbox_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(32), index=True, default="processed")
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    processing_lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


SandboxEventReceipt = WebhookEventReceipt
