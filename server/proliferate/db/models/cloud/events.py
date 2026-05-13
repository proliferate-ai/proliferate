"""Cloud synced session event ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudSessionEvent(Base):
    __tablename__ = "cloud_session_event"
    __table_args__ = (
        UniqueConstraint(
            "target_id",
            "session_id",
            "anyharness_sequence",
            name="uq_cloud_session_event_target_session_seq",
        ),
        Index(
            "ix_cloud_session_event_workspace_session_seq",
            "org_id",
            "workspace_id",
            "session_id",
            "anyharness_sequence",
        ),
        Index("ix_cloud_session_event_session_created", "session_id", "created_at"),
        Index("ix_cloud_session_event_type_created", "event_type", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(index=True)
    target_id: Mapped[uuid.UUID] = mapped_column(index=True)
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    session_id: Mapped[str] = mapped_column(String(255), index=True)
    anyharness_event_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    anyharness_sequence: Mapped[int] = mapped_column(Integer)
    event_type: Mapped[str] = mapped_column(String(128))
    schema_version: Mapped[str] = mapped_column(String(64), default="v1")
    source_kind: Mapped[str] = mapped_column(String(64), default="system")
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    actor_external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    payload_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    dedupe_key: Mapped[str] = mapped_column(String(512))


class CloudEventIngestCursor(Base):
    __tablename__ = "cloud_event_ingest_cursor"
    __table_args__ = (
        UniqueConstraint(
            "target_id",
            "session_id",
            name="uq_cloud_event_ingest_cursor_target_session",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target_id: Mapped[uuid.UUID] = mapped_column(index=True)
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    session_id: Mapped[str] = mapped_column(String(255), index=True)
    last_contiguous_sequence: Mapped[int] = mapped_column(Integer, default=0)
    highest_seen_sequence: Mapped[int] = mapped_column(Integer, default=0)
    gap_sequences_json: Mapped[str] = mapped_column(Text, default="[]")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
