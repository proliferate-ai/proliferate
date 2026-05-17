"""Cloud target Git identity ORM model."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.constants.cloud import SUPPORTED_CLOUD_TARGET_CONFIG_STATUSES
from proliferate.db.models.base import Base, utcnow


class CloudTargetGitIdentity(Base):
    __tablename__ = "cloud_target_git_identities"
    __table_args__ = (
        CheckConstraint(
            f"materialization_status IN {SUPPORTED_CLOUD_TARGET_CONFIG_STATUSES}",
            name="ck_cloud_target_git_identities_materialization_status",
        ),
        Index(
            "uq_cloud_target_git_identities_target_provider",
            "target_id",
            "provider",
            unique=True,
        ),
        Index(
            "ix_cloud_target_git_identities_target_status",
            "target_id",
            "materialization_status",
        ),
        Index("ix_cloud_target_git_identities_user_id", "user_id"),
        Index("ix_cloud_target_git_identities_last_command", "last_command_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    provider: Mapped[str] = mapped_column(String(32), default="github")
    config_version: Mapped[int] = mapped_column(Integer, default=1)
    payload_ciphertext: Mapped[str] = mapped_column(Text)
    summary_json: Mapped[str] = mapped_column(Text)
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
