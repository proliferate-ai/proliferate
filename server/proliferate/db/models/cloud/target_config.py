"""Cloud target environment/materialization ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.constants.cloud import SUPPORTED_CLOUD_TARGET_CONFIG_STATUSES
from proliferate.db.models.base import Base, utcnow


class CloudTargetConfig(Base):
    __tablename__ = "cloud_target_configs"
    __table_args__ = (
        CheckConstraint(
            f"materialization_status IN {SUPPORTED_CLOUD_TARGET_CONFIG_STATUSES}",
            name="ck_cloud_target_configs_materialization_status",
        ),
        Index(
            "uq_cloud_target_configs_target_repo",
            "target_id",
            "git_provider",
            "git_owner",
            "git_repo_name",
            unique=True,
        ),
        Index("ix_cloud_target_configs_target_status", "target_id", "materialization_status"),
        Index("ix_cloud_target_configs_user_repo", "user_id", "git_owner", "git_repo_name"),
        Index("ix_cloud_target_configs_last_command", "last_command_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    git_provider: Mapped[str] = mapped_column(String(32), default="github")
    git_owner: Mapped[str] = mapped_column(String(255))
    git_repo_name: Mapped[str] = mapped_column(String(255))
    workspace_root: Mapped[str] = mapped_column(Text)
    config_version: Mapped[int] = mapped_column(Integer, default=1)
    payload_ciphertext: Mapped[str] = mapped_column(Text)
    summary_json: Mapped[str] = mapped_column(Text)
    env_vars_version: Mapped[int] = mapped_column(Integer, default=0)
    files_version: Mapped[int] = mapped_column(Integer, default=0)
    credential_snapshot_version: Mapped[int] = mapped_column(Integer, default=0)
    mcp_materialization_version: Mapped[int] = mapped_column(Integer, default=0)
    materialization_status: Mapped[str] = mapped_column(String(32), default="pending")
    last_command_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_commands.id", ondelete="SET NULL"),
        nullable=True,
    )
    last_materialized_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    runtime_config_revision_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "cloud_target_runtime_config_revisions.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_cloud_target_configs_runtime_config_revision",
        ),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudTargetRuntimeConfigRevision(Base):
    __tablename__ = "cloud_target_runtime_config_revisions"
    __table_args__ = (
        Index(
            "ix_cloud_target_runtime_config_revisions_target_sequence",
            "target_id",
            "revision_sequence",
        ),
        Index(
            "uq_cloud_target_runtime_config_revisions_content",
            "target_id",
            "content_hash",
            unique=True,
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    target_config_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_target_configs.id", ondelete="CASCADE"),
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=True,
    )
    revision_sequence: Mapped[int] = mapped_column(Integer)
    content_hash: Mapped[str] = mapped_column(String(128))
    manifest_json: Mapped[str] = mapped_column(Text)
    warnings_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CloudTargetRuntimeConfigCurrent(Base):
    __tablename__ = "cloud_target_runtime_config_current"

    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        primary_key=True,
    )
    revision_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_target_runtime_config_revisions.id", ondelete="CASCADE")
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CloudTargetRuntimeConfigArtifact(Base):
    __tablename__ = "cloud_target_runtime_config_artifacts"
    __table_args__ = (
        Index(
            "uq_cloud_target_runtime_config_artifacts_revision_hash",
            "revision_id",
            "artifact_hash",
            unique=True,
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    revision_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_target_runtime_config_revisions.id", ondelete="CASCADE"),
        index=True,
    )
    artifact_hash: Mapped[str] = mapped_column(String(128))
    content_type: Mapped[str] = mapped_column(String(255))
    byte_size: Mapped[int] = mapped_column(Integer)
    payload_ciphertext: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
