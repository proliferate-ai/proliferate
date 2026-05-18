"""Cloud event-sync and projection ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudSessionEvent(Base):
    __tablename__ = "cloud_session_events"
    __table_args__ = (
        UniqueConstraint(
            "target_id",
            "session_id",
            "anyharness_seq",
            name="uq_cloud_session_events_target_session_seq",
        ),
        Index("ix_cloud_session_events_session_seq", "session_id", "anyharness_seq"),
        Index("ix_cloud_session_events_target_session", "target_id", "session_id"),
        Index("ix_cloud_session_events_cloud_workspace", "cloud_workspace_id"),
        Index("ix_cloud_session_events_type", "event_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    worker_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workers.id", ondelete="SET NULL"),
        nullable=True,
    )
    cloud_workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workspace.id", ondelete="SET NULL"),
        nullable=True,
    )
    workspace_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    session_id: Mapped[str] = mapped_column(String(255), index=True)
    anyharness_seq: Mapped[int] = mapped_column(Integer)
    event_type: Mapped[str] = mapped_column(String(128), index=True)
    schema_version: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"))
    source_kind: Mapped[str] = mapped_column(String(32), default="system")
    turn_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    item_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    occurred_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_hash: Mapped[str] = mapped_column(String(64))
    payload_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_size_bytes: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    payload_truncated_at_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CloudEventIngestState(Base):
    __tablename__ = "cloud_event_ingest_state"

    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        primary_key=True,
    )
    session_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    worker_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workers.id", ondelete="SET NULL"),
        nullable=True,
    )
    cloud_workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workspace.id", ondelete="SET NULL"),
        nullable=True,
    )
    workspace_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_contiguous_seq: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CloudSyncedWorkspace(Base):
    __tablename__ = "cloud_synced_workspaces"
    __table_args__ = (
        UniqueConstraint(
            "target_id",
            "workspace_id",
            name="uq_cloud_synced_workspaces_target_workspace",
        ),
        Index("ix_cloud_synced_workspaces_cloud_workspace", "cloud_workspace_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    cloud_workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_workspace.id", ondelete="CASCADE"),
    )
    workspace_id: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudSessionProjection(Base):
    __tablename__ = "cloud_sessions"
    __table_args__ = (
        UniqueConstraint(
            "target_id",
            "session_id",
            name="uq_cloud_sessions_target_session",
        ),
        Index("ix_cloud_sessions_target_status", "target_id", "status"),
        Index("ix_cloud_sessions_cloud_workspace", "cloud_workspace_id"),
        Index("ix_cloud_sessions_last_event_seq", "last_event_seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    cloud_workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workspace.id", ondelete="SET NULL"),
        nullable=True,
    )
    workspace_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    session_id: Mapped[str] = mapped_column(String(255), index=True)
    native_session_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_agent_kind: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="running", index=True)
    phase: Mapped[str | None] = mapped_column(String(64), nullable=True)
    live_config_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_event_seq: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    last_event_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    started_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ended_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudTranscriptItem(Base):
    __tablename__ = "cloud_transcript_items"
    __table_args__ = (
        UniqueConstraint(
            "target_id",
            "session_id",
            "item_id",
            name="uq_cloud_transcript_items_target_session_item",
        ),
        Index("ix_cloud_transcript_items_session_seq", "session_id", "last_seq"),
        Index("ix_cloud_transcript_items_cloud_workspace", "cloud_workspace_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    cloud_workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workspace.id", ondelete="SET NULL"),
        nullable=True,
    )
    workspace_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    session_id: Mapped[str] = mapped_column(String(255), index=True)
    item_id: Mapped[str] = mapped_column(String(255))
    turn_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    kind: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_agent_kind: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    first_seq: Mapped[int] = mapped_column(Integer)
    last_seq: Mapped[int] = mapped_column(Integer)
    completed_seq: Mapped[int | None] = mapped_column(Integer, nullable=True)
    first_event_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_event_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudPendingInteraction(Base):
    __tablename__ = "cloud_pending_interactions"
    __table_args__ = (
        UniqueConstraint(
            "target_id",
            "session_id",
            "request_id",
            name="uq_cloud_pending_interactions_target_session_request",
        ),
        Index("ix_cloud_pending_interactions_session_status", "session_id", "status"),
        Index("ix_cloud_pending_interactions_cloud_workspace", "cloud_workspace_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    cloud_workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workspace.id", ondelete="SET NULL"),
        nullable=True,
    )
    workspace_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    session_id: Mapped[str] = mapped_column(String(255), index=True)
    request_id: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_seq: Mapped[int] = mapped_column(Integer)
    resolved_seq: Mapped[int | None] = mapped_column(Integer, nullable=True)
    requested_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    resolved_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
