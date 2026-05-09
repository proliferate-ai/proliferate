"""Cloud workspace ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import (
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
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudWorkspace(Base):
    __tablename__ = "cloud_workspace"
    __table_args__ = (
        Index(
            "uq_cloud_workspace_active_branch",
            "runtime_environment_id",
            "git_branch",
            unique=True,
            postgresql_where=text("archived_at IS NULL"),
        ),
        CheckConstraint(
            "owner_scope IN ('personal', 'organization')",
            name="ck_cloud_workspace_owner_scope",
        ),
        CheckConstraint(
            "owner_scope != 'personal' OR (owner_user_id IS NOT NULL AND organization_id IS NULL)",
            name="ck_cloud_workspace_personal_owner",
        ),
        CheckConstraint(
            "owner_scope != 'organization' OR "
            "(organization_id IS NOT NULL AND owner_user_id IS NULL)",
            name="ck_cloud_workspace_organization_owner",
        ),
        CheckConstraint(
            "created_by_user_id IS NOT NULL",
            name="ck_cloud_workspace_created_by_user_id",
        ),
    )

    def __init__(self, **kwargs: object) -> None:
        user_id = kwargs.get("user_id")
        kwargs.setdefault("owner_scope", "personal")
        kwargs.setdefault("owner_user_id", user_id)
        kwargs.setdefault("organization_id", None)
        kwargs.setdefault("created_by_user_id", user_id)
        super().__init__(**kwargs)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    owner_scope: Mapped[str] = mapped_column(
        String(32),
        default="personal",
        server_default=text("'personal'"),
    )
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    billing_subject_id: Mapped[uuid.UUID] = mapped_column(index=True)
    runtime_environment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_runtime_environment.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )

    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    git_provider: Mapped[str] = mapped_column(String(32))
    git_owner: Mapped[str] = mapped_column(String(255))
    git_repo_name: Mapped[str] = mapped_column(String(255))
    git_branch: Mapped[str] = mapped_column(String(255))
    git_base_branch: Mapped[str | None] = mapped_column(String(255), nullable=True)
    origin_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(String(32))
    status_detail: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    template_version: Mapped[str] = mapped_column(String(64))

    # Runtime fields below are compatibility-only during the environment
    # migration. New code should read/write CloudRuntimeEnvironment.
    runtime_generation: Mapped[int] = mapped_column(Integer, default=0)

    active_sandbox_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    runtime_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    runtime_token_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    anyharness_data_key_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    anyharness_workspace_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    repo_env_vars_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    repo_files_applied_version: Mapped[int] = mapped_column(Integer, default=0)
    repo_setup_applied_version: Mapped[int] = mapped_column(Integer, default=0)
    repo_post_ready_phase: Mapped[str] = mapped_column(String(32), default="idle")
    repo_post_ready_files_total: Mapped[int] = mapped_column(Integer, default=0)
    repo_post_ready_files_applied: Mapped[int] = mapped_column(Integer, default=0)
    repo_post_ready_apply_token: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )
    repo_files_last_failed_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    repo_files_last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    repo_files_applied_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    repo_post_ready_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    repo_post_ready_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    archive_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cleanup_state: Mapped[str] = mapped_column(String(32), default="none")
    cleanup_last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class CloudWorkspaceSetupRun(Base):
    __tablename__ = "cloud_workspace_setup_run"
    __table_args__ = (
        Index(
            "ix_cloud_workspace_setup_run_reconciler",
            "status",
            "deadline_at",
            "claim_until",
            "next_poll_at",
        ),
        Index(
            "ix_cloud_workspace_setup_run_workspace_token",
            "workspace_id",
            "apply_token",
            "setup_script_version",
        ),
        UniqueConstraint("command_run_id", name="uq_cloud_workspace_setup_run_command_run_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_workspace.id", ondelete="CASCADE"),
        index=True,
    )
    anyharness_workspace_id: Mapped[str] = mapped_column(String(255))
    terminal_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    command_run_id: Mapped[str] = mapped_column(String(255))
    setup_script_version: Mapped[int] = mapped_column(Integer)
    apply_token: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default="pending")
    deadline_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    claim_owner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    claim_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_polled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_poll_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
