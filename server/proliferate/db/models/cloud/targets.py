"""Cloud worker target ORM models."""

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


class CloudTarget(Base):
    __tablename__ = "cloud_targets"
    __table_args__ = (
        Index("ix_cloud_targets_org_kind_archived", "org_id", "kind", "archived_at"),
        CheckConstraint(
            "kind IN ("
            "'managed_cloud', 'self_hosted_cloud', 'ssh', 'desktop_dispatch', "
            "'local_direct', 'future_vpc_worker'"
            ")",
            name="ck_cloud_targets_kind",
        ),
        CheckConstraint(
            "access_scope IN ('personal', 'team', 'org')",
            name="ck_cloud_targets_access_scope",
        ),
        CheckConstraint(
            "persistence_class IN ('ephemeral', 'persistent', 'snapshot_backed', 'unknown')",
            name="ck_cloud_targets_persistence_class",
        ),
        CheckConstraint(
            "direct_attach_policy IN ('disabled', 'owner_only', 'team_grant', 'org_grant')",
            name="ck_cloud_targets_direct_attach_policy",
        ),
        CheckConstraint(
            "update_channel IN ('stable', 'beta', 'pinned')",
            name="ck_cloud_targets_update_channel",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(index=True)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    display_name: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(32))
    access_scope: Mapped[str] = mapped_column(String(32), default="personal")
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    default_workspace_root: Mapped[str | None] = mapped_column(Text, nullable=True)
    persistence_class: Mapped[str] = mapped_column(String(32), default="unknown")
    direct_attach_policy: Mapped[str] = mapped_column(String(32), default="disabled")
    cloud_sync_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    update_channel: Mapped[str] = mapped_column(String(32), default="stable")
    desired_anyharness_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    desired_worker_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    desired_supervisor_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CloudTargetEnrollment(Base):
    __tablename__ = "cloud_target_enrollments"
    __table_args__ = (
        Index("ix_cloud_target_enrollments_token_hash", "token_hash", unique=True),
        Index("ix_cloud_target_enrollments_org_expires", "org_id", "expires_at"),
        CheckConstraint(
            "kind IN ("
            "'managed_cloud', 'self_hosted_cloud', 'ssh', 'desktop_dispatch', "
            "'local_direct', 'future_vpc_worker'"
            ")",
            name="ck_cloud_target_enrollments_kind",
        ),
        CheckConstraint(
            "access_scope IN ('personal', 'team', 'org')",
            name="ck_cloud_target_enrollments_access_scope",
        ),
        CheckConstraint(
            "persistence_class IN ('ephemeral', 'persistent', 'snapshot_backed', 'unknown')",
            name="ck_cloud_target_enrollments_persistence_class",
        ),
        CheckConstraint(
            "direct_attach_policy IN ('disabled', 'owner_only', 'team_grant', 'org_grant')",
            name="ck_cloud_target_enrollments_direct_attach_policy",
        ),
        CheckConstraint(
            "update_channel IN ('stable', 'beta', 'pinned')",
            name="ck_cloud_target_enrollments_update_channel",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        nullable=True,
    )
    org_id: Mapped[uuid.UUID] = mapped_column(index=True)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    token_hash: Mapped[str] = mapped_column(String(64))
    display_name: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(32))
    access_scope: Mapped[str] = mapped_column(String(32), default="personal")
    default_workspace_root: Mapped[str | None] = mapped_column(Text, nullable=True)
    persistence_class: Mapped[str] = mapped_column(String(32), default="unknown")
    direct_attach_policy: Mapped[str] = mapped_column(String(32), default="disabled")
    cloud_sync_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    update_channel: Mapped[str] = mapped_column(String(32), default="stable")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudWorker(Base):
    __tablename__ = "cloud_workers"
    __table_args__ = (
        UniqueConstraint("install_id", name="uq_cloud_workers_install_id"),
        Index("ix_cloud_workers_target_status", "target_id", "status"),
        Index("ix_cloud_workers_last_seen", "last_seen_at"),
        CheckConstraint(
            "status IN ('enrolling', 'active', 'revoked', 'rotated')",
            name="ck_cloud_workers_status",
        ),
        CheckConstraint(
            "anyharness_endpoint_kind IN ('http', 'unix_socket')",
            name="ck_cloud_workers_anyharness_endpoint_kind",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    org_id: Mapped[uuid.UUID] = mapped_column(index=True)
    install_id: Mapped[str] = mapped_column(String(255))
    credential_hash: Mapped[str] = mapped_column(String(64))
    public_key_fingerprint: Mapped[str | None] = mapped_column(String(255), nullable=True)
    auth_version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(32), default="active")
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_heartbeat_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    worker_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    supervisor_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    anyharness_endpoint_kind: Mapped[str] = mapped_column(String(32), default="http")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CloudTargetStatus(Base):
    __tablename__ = "cloud_target_status"
    __table_args__ = (
        UniqueConstraint("target_id", name="uq_cloud_target_status_target_id"),
        CheckConstraint(
            "online_status IN ('online', 'degraded', 'offline')",
            name="ck_cloud_target_status_online_status",
        ),
        CheckConstraint(
            "safe_stop_state IN ('safe', 'blocked', 'unknown')",
            name="ck_cloud_target_status_safe_stop_state",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    org_id: Mapped[uuid.UUID] = mapped_column(index=True)
    online_status: Mapped[str] = mapped_column(String(32), default="offline")
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_inventory_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_activity_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    worker_connected: Mapped[bool] = mapped_column(Boolean, default=False)
    anyharness_reachable: Mapped[bool] = mapped_column(Boolean, default=False)
    anyharness_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    worker_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    supervisor_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    safe_stop_state: Mapped[str] = mapped_column(String(32), default="unknown")
    safe_stop_reasons: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    active_session_count: Mapped[int] = mapped_column(Integer, default=0)
    active_turn_count: Mapped[int] = mapped_column(Integer, default=0)
    pending_interaction_count: Mapped[int] = mapped_column(Integer, default=0)
    active_terminal_count: Mapped[int] = mapped_column(Integer, default=0)
    active_process_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudTargetInventory(Base):
    __tablename__ = "cloud_target_inventory"
    __table_args__ = (UniqueConstraint("target_id", name="uq_cloud_target_inventory_target_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    org_id: Mapped[uuid.UUID] = mapped_column(index=True)
    os_kind: Mapped[str | None] = mapped_column(String(64), nullable=True)
    os_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    arch: Mapped[str | None] = mapped_column(String(64), nullable=True)
    distro: Mapped[str | None] = mapped_column(String(128), nullable=True)
    shell: Mapped[str | None] = mapped_column(String(255), nullable=True)
    package_managers: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    workspace_roots: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    supports_process_spawn: Mapped[bool] = mapped_column(Boolean, default=False)
    supports_pty: Mapped[bool] = mapped_column(Boolean, default=False)
    supports_filesystem: Mapped[bool] = mapped_column(Boolean, default=False)
    supports_git: Mapped[bool] = mapped_column(Boolean, default=False)
    supports_network_egress: Mapped[bool] = mapped_column(Boolean, default=False)
    supports_port_forwarding: Mapped[bool] = mapped_column(Boolean, default=False)
    supports_browser: Mapped[bool] = mapped_column(Boolean, default=False)
    supports_computer_use: Mapped[bool] = mapped_column(Boolean, default=False)
    supports_docker: Mapped[bool] = mapped_column(Boolean, default=False)
    node_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    npm_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    python_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    uv_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    git_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    provider_readiness: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    mcp_readiness: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    agent_catalog_revision: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
