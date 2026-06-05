"""Agent-auth ORM profiles models."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.constants.cloud import (
    SUPPORTED_SANDBOX_AGENT_AUTH_TARGET_STATE_STATUSES,
    SUPPORTED_SANDBOX_PROFILE_OWNER_SCOPES,
    SUPPORTED_SANDBOX_PROFILE_STATUSES,
    SUPPORTED_SANDBOX_PROFILE_TARGET_STATE_STATUSES,
)
from proliferate.db.models.base import Base, utcnow


class SandboxProfile(Base):
    __tablename__ = "sandbox_profile"
    __table_args__ = (
        CheckConstraint(
            f"owner_scope IN {SUPPORTED_SANDBOX_PROFILE_OWNER_SCOPES}",
            name="ck_sandbox_profile_owner_scope",
        ),
        CheckConstraint(
            "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'organization' AND owner_user_id IS NULL "
            "AND organization_id IS NOT NULL))",
            name="ck_sandbox_profile_owner_fields",
        ),
        CheckConstraint(
            f"status IN {SUPPORTED_SANDBOX_PROFILE_STATUSES}",
            name="ck_sandbox_profile_status",
        ),
        Index(
            "uq_sandbox_profile_active_personal_user",
            "owner_user_id",
            unique=True,
            postgresql_where=text("owner_scope = 'personal' AND archived_at IS NULL"),
        ),
        Index(
            "uq_sandbox_profile_active_organization",
            "organization_id",
            unique=True,
            postgresql_where=text("owner_scope = 'organization' AND archived_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_scope: Mapped[str] = mapped_column(String(32), index=True)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    billing_subject_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("billing_subject.id", ondelete="RESTRICT"),
        index=True,
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    desired_agent_auth_revision: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="configuring", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SandboxProfileAgentAuthRevision(Base):
    __tablename__ = "sandbox_profile_agent_auth_revision"
    __table_args__ = (
        Index(
            "uq_sandbox_profile_agent_auth_revision_profile_revision",
            "sandbox_profile_id",
            "revision",
            unique=True,
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sandbox_profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sandbox_profile.id", ondelete="CASCADE"),
        index=True,
    )
    revision: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(128))
    force_restart: Mapped[bool] = mapped_column(default=False)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SandboxProfileTargetState(Base):
    __tablename__ = "sandbox_profile_target_state"
    __table_args__ = (
        CheckConstraint(
            f"agent_auth_status IN {SUPPORTED_SANDBOX_AGENT_AUTH_TARGET_STATE_STATUSES}",
            name="ck_sandbox_profile_target_state_agent_auth_status",
        ),
        CheckConstraint(
            f"runtime_config_status IN {SUPPORTED_SANDBOX_PROFILE_TARGET_STATE_STATUSES}",
            name="ck_sandbox_profile_target_state_runtime_config_status",
        ),
        CheckConstraint(
            "applied_agent_auth_revision IS NULL "
            "OR applied_agent_auth_revision <= desired_agent_auth_revision",
            name="ck_sandbox_profile_target_state_agent_auth_applied_lte_desired",
        ),
        Index(
            "uq_sandbox_profile_target_state_target_profile",
            "target_id",
            "sandbox_profile_id",
            unique=True,
        ),
        Index(
            "ix_sandbox_profile_target_state_agent_auth_status_revision",
            "target_id",
            "agent_auth_status",
            "desired_agent_auth_revision",
            "applied_agent_auth_revision",
        ),
        Index(
            "ix_sandbox_profile_target_state_runtime_config_status",
            "target_id",
            "runtime_config_status",
            "applied_runtime_config_sequence",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sandbox_profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sandbox_profile.id", ondelete="CASCADE"),
        index=True,
    )
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    desired_agent_auth_revision: Mapped[int] = mapped_column(Integer, default=0)
    applied_agent_auth_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    agent_auth_status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    agent_auth_force_restart_required: Mapped[bool] = mapped_column(default=False)
    last_agent_auth_command_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_commands.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    last_agent_auth_worker_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workers.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    last_agent_auth_attempted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_agent_auth_applied_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_agent_auth_error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_agent_auth_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    pending_agent_auth_cleanup_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    applied_runtime_config_sequence: Mapped[int] = mapped_column(Integer, default=0)
    applied_runtime_config_revision_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    runtime_config_status: Mapped[str] = mapped_column(String(32), default="applied")
    last_runtime_config_command_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_commands.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    last_runtime_config_worker_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workers.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    last_runtime_config_attempted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_runtime_config_applied_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_runtime_config_error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_runtime_config_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
