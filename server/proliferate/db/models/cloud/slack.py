"""Slack bot ORM models for cloud-managed team work."""

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


class SlackWorkspaceConnection(Base):
    __tablename__ = "slack_workspace_connection"
    __table_args__ = (
        UniqueConstraint("slack_team_id", name="uq_slack_workspace_connection_team"),
        Index(
            "ux_slack_workspace_connection_active_org",
            "organization_id",
            unique=True,
            postgresql_where=text("status != 'revoked'"),
        ),
        CheckConstraint(
            "status IN ('active', 'reauth_required', 'revoked')",
            name="ck_slack_workspace_connection_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        index=True,
    )
    slack_team_id: Mapped[str] = mapped_column(String(255), nullable=False)
    slack_team_name: Mapped[str] = mapped_column(Text, nullable=False)
    slack_bot_user_id: Mapped[str] = mapped_column(String(255), nullable=False)
    bot_token_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    bot_token_ciphertext_key_id: Mapped[str] = mapped_column(String(255), nullable=False)
    bot_scopes: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(32),
        default="active",
        server_default=text("'active'"),
    )
    installed_by_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    installed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class SlackBotConfig(Base):
    __tablename__ = "slack_bot_config"
    __table_args__ = (
        UniqueConstraint("organization_id", name="uq_slack_bot_config_organization"),
        CheckConstraint(
            "repo_mode IN ('fixed', 'auto')",
            name="ck_slack_bot_config_repo_mode",
        ),
        CheckConstraint(
            "repo_mode != 'fixed' OR fixed_cloud_repo_config_id IS NOT NULL",
            name="ck_slack_bot_config_fixed_repo_present",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        index=True,
    )
    slack_workspace_connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("slack_workspace_connection.id", ondelete="CASCADE"),
        index=True,
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    repo_mode: Mapped[str] = mapped_column(
        String(32),
        default="auto",
        server_default=text("'auto'"),
    )
    fixed_cloud_repo_config_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_repo_config.id", ondelete="SET NULL"),
        nullable=True,
    )
    allowed_cloud_repo_config_ids: Mapped[str | None] = mapped_column(Text)
    default_agent_kind: Mapped[str | None] = mapped_column(String(32))
    default_agent_run_config_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_agent_run_config.id", ondelete="SET NULL"),
        nullable=True,
    )
    allowed_slack_channel_ids: Mapped[str | None] = mapped_column(Text)
    ack_message_template: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class SlackThreadWork(Base):
    __tablename__ = "slack_thread_work"
    __table_args__ = (
        UniqueConstraint(
            "slack_team_id",
            "slack_channel_id",
            "slack_thread_ts",
            name="uq_slack_thread_work_thread",
        ),
        CheckConstraint(
            "status IN ('active', 'archived')",
            name="ck_slack_thread_work_status",
        ),
        Index("ix_slack_thread_work_cloud_workspace", "cloud_workspace_id"),
        Index("ix_slack_thread_work_cloud_session", "cloud_session_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        index=True,
    )
    slack_team_id: Mapped[str] = mapped_column(String(255), nullable=False)
    slack_channel_id: Mapped[str] = mapped_column(String(255), nullable=False)
    slack_thread_ts: Mapped[str] = mapped_column(String(255), nullable=False)
    cloud_workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_workspace.id", ondelete="CASCADE"),
        index=True,
    )
    cloud_session_id: Mapped[str | None] = mapped_column(String(255))
    cloud_workspace_exposure_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workspace_exposure.id", ondelete="SET NULL"),
        nullable=True,
    )
    cloud_session_projection_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_sessions.id", ondelete="SET NULL"),
        nullable=True,
    )
    root_message_ts: Mapped[str] = mapped_column(String(255), nullable=False)
    bot_ack_message_ts: Mapped[str | None] = mapped_column(String(255))
    initial_repo_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_repo_config.id", ondelete="RESTRICT"),
    )
    agent_run_config_snapshot_json: Mapped[dict[str, object] | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(
        String(32),
        default="active",
        server_default=text("'active'"),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SlackEventEnvelopeSeen(Base):
    __tablename__ = "slack_event_envelope_seen"

    slack_event_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SlackInboundEventJob(Base):
    __tablename__ = "slack_inbound_event_job"
    __table_args__ = (
        Index("ix_slack_inbound_event_job_status", "status", "next_attempt_at"),
        CheckConstraint(
            "status IN ('queued', 'processing', 'completed', 'failed')",
            name="ck_slack_inbound_event_job_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    slack_event_id: Mapped[str] = mapped_column(String(255), index=True)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    slack_team_id: Mapped[str | None] = mapped_column(String(255))
    event_type: Mapped[str] = mapped_column(String(128))
    payload_json: Mapped[dict[str, object]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(
        String(32),
        default="queued",
        server_default=text("'queued'"),
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_error_code: Mapped[str | None] = mapped_column(String(128))
    last_error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SlackOutboundMessageQueue(Base):
    __tablename__ = "slack_outbound_message_queue"
    __table_args__ = (
        Index("ix_slack_outbound_message_queue_status", "status", "next_attempt_at"),
        Index(
            "ux_slack_outbound_message_source_event",
            "slack_workspace_connection_id",
            "source_event_id",
            unique=True,
            postgresql_where=text("source_event_id IS NOT NULL"),
        ),
        CheckConstraint(
            "status IN ('queued', 'sending', 'sent', 'failed', 'dropped')",
            name="ck_slack_outbound_status",
        ),
        CheckConstraint(
            "source IN ('ack', 'turn', 'interaction', 'done', 'failed', 'admin')",
            name="ck_slack_outbound_source",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        index=True,
    )
    slack_workspace_connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("slack_workspace_connection.id", ondelete="CASCADE"),
        index=True,
    )
    slack_team_id: Mapped[str] = mapped_column(String(255), nullable=False)
    slack_channel_id: Mapped[str] = mapped_column(String(255), nullable=False)
    slack_thread_ts: Mapped[str | None] = mapped_column(String(255))
    blocks_json: Mapped[list[dict[str, object]]] = mapped_column(JSONB)
    fallback_text: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    source_event_id: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(
        String(32),
        default="queued",
        server_default=text("'queued'"),
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_error_code: Mapped[str | None] = mapped_column(String(128))
    last_error_message: Mapped[str | None] = mapped_column(Text)
    sent_message_ts: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CloudRepoRoutingProfile(Base):
    __tablename__ = "cloud_repo_routing_profile"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    cloud_repo_config_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_repo_config.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        index=True,
    )
    display_name: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    readme_summary: Mapped[str | None] = mapped_column(Text)
    languages_json: Mapped[list[str] | None] = mapped_column(JSONB)
    topics_json: Mapped[list[str] | None] = mapped_column(JSONB)
    cached_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
