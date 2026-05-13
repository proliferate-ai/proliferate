"""Cloud normalized session event ORM models."""

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
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudSessionEvent(Base):
    __tablename__ = "cloud_session_events"
    __table_args__ = (
        Index(
            "uq_cloud_session_events_target_session_seq",
            "target_id",
            "session_id",
            "anyharness_sequence",
            unique=True,
        ),
        Index(
            "ix_cloud_session_events_org_workspace_session_seq",
            "org_id",
            "workspace_id",
            "session_id",
            "anyharness_sequence",
        ),
        Index("ix_cloud_session_events_session_created", "session_id", "created_at"),
        Index("ix_cloud_session_events_type_created", "event_type", "created_at"),
        Index(
            "uq_cloud_session_events_target_anyharness_event",
            "target_id",
            "anyharness_event_id",
            unique=True,
            postgresql_where=text("anyharness_event_id IS NOT NULL"),
        ),
        CheckConstraint(
            "source_kind IN ('user', 'assistant', 'tool', 'system', 'worker', 'target')",
            name="ck_cloud_session_events_source_kind",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(index=True)
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    session_id: Mapped[uuid.UUID] = mapped_column(index=True)
    anyharness_event_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    anyharness_sequence: Mapped[int] = mapped_column(BigInteger)
    event_type: Mapped[str] = mapped_column(String(128))
    schema_version: Mapped[int] = mapped_column(Integer)
    source_kind: Mapped[str] = mapped_column(String(32))
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    actor_external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    payload: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)
    payload_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    payload_hash: Mapped[str] = mapped_column(String(64))
    dedupe_key: Mapped[str] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CloudEventIngestCursor(Base):
    __tablename__ = "cloud_event_ingest_cursors"
    __table_args__ = (
        Index(
            "uq_cloud_event_ingest_cursors_target_session",
            "target_id",
            "session_id",
            unique=True,
        ),
        CheckConstraint(
            "cursor_status IN ('current', 'gap', 'degraded')",
            name="ck_cloud_event_ingest_cursors_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(index=True)
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    session_id: Mapped[uuid.UUID] = mapped_column(index=True)
    contiguous_sequence: Mapped[int] = mapped_column(BigInteger, default=0)
    highest_seen_sequence: Mapped[int] = mapped_column(BigInteger, default=0)
    cursor_status: Mapped[str] = mapped_column(String(32), default="current")
    gap_ranges: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
