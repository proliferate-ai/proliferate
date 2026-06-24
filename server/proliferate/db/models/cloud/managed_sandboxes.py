"""Managed cloud sandbox ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class ManagedSandbox(Base):
    __tablename__ = "managed_sandbox"
    __table_args__ = (
        CheckConstraint(
            "owner_scope IN ('personal', 'organization')",
            name="ck_managed_sandbox_owner_scope",
        ),
        CheckConstraint(
            "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'organization' AND organization_id IS NOT NULL "
            "AND owner_user_id IS NULL))",
            name="ck_managed_sandbox_owner_fields",
        ),
        CheckConstraint(
            "status IN ('creating', 'starting', 'ready', 'paused', 'error', 'destroyed')",
            name="ck_managed_sandbox_status",
        ),
        Index(
            "ux_managed_sandbox_personal_active",
            "owner_user_id",
            unique=True,
            postgresql_where=text("owner_scope = 'personal' AND destroyed_at IS NULL"),
        ),
        Index(
            "ux_managed_sandbox_organization_active",
            "organization_id",
            unique=True,
            postgresql_where=text("owner_scope = 'organization' AND destroyed_at IS NULL"),
        ),
        Index("ix_managed_sandbox_owner_status", "owner_scope", "status"),
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
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    billing_subject_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("billing_subject.id", ondelete="RESTRICT"),
        index=True,
    )

    status: Mapped[str] = mapped_column(String(32), index=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    e2b_sandbox_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    e2b_template_ref: Mapped[str] = mapped_column(Text)

    anyharness_base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    anyharness_bearer_token_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    anyharness_data_key_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    runtime_generation: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_health_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    destroyed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ManagedSandboxRepoMaterialization(Base):
    __tablename__ = "managed_sandbox_repo_materialization"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'running', 'ready', 'error', 'disabled')",
            name="ck_managed_sandbox_repo_materialization_status",
        ),
        Index(
            "ux_managed_sandbox_repo_materialization_repo",
            "managed_sandbox_id",
            "cloud_repo_config_id",
            unique=True,
        ),
        Index(
            "ix_managed_sandbox_repo_materialization_status",
            "managed_sandbox_id",
            "status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    managed_sandbox_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("managed_sandbox.id", ondelete="CASCADE"),
        index=True,
    )
    cloud_repo_config_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_repo_config.id", ondelete="CASCADE"),
        index=True,
    )
    sandbox_generation: Mapped[int] = mapped_column(Integer, default=0)

    status: Mapped[str] = mapped_column(String(32), index=True)
    repo_path: Mapped[str] = mapped_column(Text)
    anyharness_repo_root_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    anyharness_workspace_id: Mapped[str | None] = mapped_column(Text, nullable=True)

    applied_files_version: Mapped[int] = mapped_column(Integer, default=0)
    applied_setup_script_version: Mapped[int] = mapped_column(Integer, default=0)
    applied_env_vars_version: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_attempted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    materialized_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
