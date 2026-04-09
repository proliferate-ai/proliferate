"""Cloud-domain ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudWorkspace(Base):
    __tablename__ = "cloud_workspace"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)

    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    git_provider: Mapped[str] = mapped_column(String(32))
    git_owner: Mapped[str] = mapped_column(String(255))
    git_repo_name: Mapped[str] = mapped_column(String(255))
    git_branch: Mapped[str] = mapped_column(String(255))
    git_base_branch: Mapped[str | None] = mapped_column(String(255), nullable=True)

    status: Mapped[str] = mapped_column(String(32))
    status_detail: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    template_version: Mapped[str] = mapped_column(String(64))
    runtime_generation: Mapped[int] = mapped_column(Integer, default=0)

    active_sandbox_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    runtime_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    runtime_token_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    anyharness_workspace_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    repo_env_vars_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    repo_files_applied_version: Mapped[int] = mapped_column(Integer, default=0)
    repo_post_ready_phase: Mapped[str] = mapped_column(String(32), default="idle")
    repo_post_ready_files_total: Mapped[int] = mapped_column(Integer, default=0)
    repo_post_ready_files_applied: Mapped[int] = mapped_column(Integer, default=0)
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


class CloudSandbox(Base):
    __tablename__ = "cloud_sandbox"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    cloud_workspace_id: Mapped[uuid.UUID] = mapped_column(index=True)

    provider: Mapped[str] = mapped_column(String(32))
    external_sandbox_id: Mapped[str | None] = mapped_column(
        String(255),
        unique=True,
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(32))
    template_version: Mapped[str] = mapped_column(String(64))
    last_provider_event_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_provider_event_kind: Mapped[str | None] = mapped_column(String(64), nullable=True)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudCredential(Base):
    __tablename__ = "cloud_credential"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    provider: Mapped[str] = mapped_column(String(32))
    auth_mode: Mapped[str] = mapped_column(String(16))
    payload_ciphertext: Mapped[str] = mapped_column(Text)
    payload_format: Mapped[str] = mapped_column(String(32), default="json-v1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    last_synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CloudRepoConfig(Base):
    __tablename__ = "cloud_repo_config"
    __table_args__ = (
        UniqueConstraint("user_id", "git_owner", "git_repo_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    git_owner: Mapped[str] = mapped_column(String(255))
    git_repo_name: Mapped[str] = mapped_column(String(255))
    configured: Mapped[bool] = mapped_column(default=False)
    configured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    env_vars_ciphertext: Mapped[str] = mapped_column(Text, default="")
    setup_script: Mapped[str] = mapped_column(Text, default="")
    files_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudRepoFile(Base):
    __tablename__ = "cloud_repo_file"
    __table_args__ = (
        UniqueConstraint("cloud_repo_config_id", "relative_path"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    cloud_repo_config_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_repo_config.id", ondelete="CASCADE"),
        index=True,
    )
    relative_path: Mapped[str] = mapped_column(String(1024))
    content_ciphertext: Mapped[str] = mapped_column(Text)
    content_sha256: Mapped[str] = mapped_column(String(64))
    byte_size: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    last_synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
