"""Cloud sandbox ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.constants.cloud import CloudSandboxStatus, CloudSandboxType
from proliferate.db.models.base import Base, utcnow

_SANDBOX_TYPE_ENUM = Enum(
    CloudSandboxType,
    name="cloud_sandbox_type",
    native_enum=False,
    values_callable=lambda values: [value.value for value in values],
    validate_strings=True,
)
_SANDBOX_STATUS_ENUM = Enum(
    CloudSandboxStatus,
    name="cloud_sandbox_status",
    native_enum=False,
    values_callable=lambda values: [value.value for value in values],
    validate_strings=True,
)


class CloudSandbox(Base):
    __tablename__ = "cloud_sandbox"
    __table_args__ = (
        CheckConstraint(
            "status IN ('creating', 'ready', 'paused', 'error', 'destroyed')",
            name="ck_cloud_sandbox_status",
        ),
        CheckConstraint(
            "sandbox_type IN ('e2b')",
            name="ck_cloud_sandbox_type",
        ),
        Index(
            "ux_cloud_sandbox_personal_active",
            "owner_user_id",
            unique=True,
            postgresql_where=text("destroyed_at IS NULL"),
        ),
        Index(
            "ux_cloud_sandbox_provider_sandbox_id",
            "provider_sandbox_id",
            unique=True,
            postgresql_where=text("provider_sandbox_id IS NOT NULL"),
        ),
        Index("ix_cloud_sandbox_owner_user_status", "owner_user_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    sandbox_type: Mapped[CloudSandboxType] = mapped_column(
        _SANDBOX_TYPE_ENUM,
        default=CloudSandboxType.e2b,
    )
    provider_sandbox_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    status: Mapped[CloudSandboxStatus] = mapped_column(_SANDBOX_STATUS_ENUM)
    anyharness_base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    runtime_token_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    anyharness_data_key_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_health_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    destroyed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
