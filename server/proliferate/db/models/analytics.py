"""First-party analytics ORM models."""

import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class ClientDailyActivity(Base):
    __tablename__ = "client_daily_activity"
    __table_args__ = (
        CheckConstraint(
            "surface IN ('desktop', 'web', 'mobile')",
            name="ck_client_daily_activity_surface",
        ),
        CheckConstraint(
            "actor_user_id IS NOT NULL OR anonymous_install_uuid IS NOT NULL",
            name="ck_client_daily_activity_identity_present",
        ),
        Index(
            "uq_client_daily_activity_actor_day_surface",
            "activity_date",
            "surface",
            "actor_user_id",
            unique=True,
            postgresql_where=text("actor_user_id IS NOT NULL"),
        ),
        Index(
            "uq_client_daily_activity_install_day_surface",
            "activity_date",
            "surface",
            "anonymous_install_uuid",
            unique=True,
            postgresql_where=text("actor_user_id IS NULL AND anonymous_install_uuid IS NOT NULL"),
        ),
        Index("ix_client_daily_activity_date_surface", "activity_date", "surface"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    activity_date: Mapped[date] = mapped_column(Date)
    surface: Mapped[str] = mapped_column(String(32))
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    anonymous_install_uuid: Mapped[uuid.UUID | None] = mapped_column(
        index=True,
        nullable=True,
    )
    telemetry_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    app_version: Mapped[str | None] = mapped_column(String(255), nullable=True)
    platform: Mapped[str | None] = mapped_column(String(64), nullable=True)
    route_or_screen: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    received_count: Mapped[int] = mapped_column(Integer, default=1)


class CloudMcpConnectionEvent(Base):
    __tablename__ = "cloud_mcp_connection_event"
    __table_args__ = (
        Index("ix_cloud_mcp_connection_event_user_day", "user_id", "occurred_at"),
        Index(
            "ix_cloud_mcp_connection_event_connection",
            "connection_id",
            "occurred_at",
        ),
        Index("ix_cloud_mcp_connection_event_type", "event_type", "occurred_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    org_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    connection_id: Mapped[str] = mapped_column(String(255))
    catalog_entry_id: Mapped[str] = mapped_column(String(255))
    event_type: Mapped[str] = mapped_column(String(64))
    auth_kind: Mapped[str | None] = mapped_column(String(32), nullable=True)
    auth_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    enabled: Mapped[bool | None] = mapped_column(nullable=True)
    failure_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CloudWorkspaceMobilityEvent(Base):
    __tablename__ = "cloud_workspace_mobility_event"
    __table_args__ = (
        Index("ix_cloud_workspace_mobility_event_user_day", "user_id", "occurred_at"),
        Index(
            "ix_cloud_workspace_mobility_event_workspace",
            "cloud_workspace_id",
            "occurred_at",
        ),
        Index(
            "ix_cloud_workspace_mobility_event_handoff",
            "handoff_op_id",
            "occurred_at",
        ),
        Index("ix_cloud_workspace_mobility_event_type", "event_type", "occurred_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    cloud_workspace_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    handoff_op_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    event_type: Mapped[str] = mapped_column(String(64))
    direction: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_owner: Mapped[str | None] = mapped_column(String(32), nullable=True)
    target_owner: Mapped[str | None] = mapped_column(String(32), nullable=True)
    from_phase: Mapped[str | None] = mapped_column(String(32), nullable=True)
    to_phase: Mapped[str | None] = mapped_column(String(32), nullable=True)
    failure_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
