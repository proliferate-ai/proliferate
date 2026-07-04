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
        CheckConstraint(
            "owner_scope IN ('personal', 'organization')",
            name="ck_cloud_sandbox_owner_scope",
        ),
        CheckConstraint(
            "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'organization' AND organization_id IS NOT NULL))",
            name="ck_cloud_sandbox_owner_fields",
        ),
        Index(
            "ux_cloud_sandbox_personal_active",
            "owner_user_id",
            unique=True,
            postgresql_where=text("destroyed_at IS NULL"),
        ),
        Index(
            "ux_cloud_sandbox_org_active",
            "organization_id",
            "display_name",
            unique=True,
            postgresql_where=text(
                "owner_scope = 'organization' AND destroyed_at IS NULL"
            ),
        ),
        Index(
            "ux_cloud_sandbox_provider_sandbox_id",
            "provider_sandbox_id",
            unique=True,
            postgresql_where=text("provider_sandbox_id IS NOT NULL"),
        ),
        Index("ix_cloud_sandbox_owner_user_status", "owner_user_id", "status"),
        Index(
            "ix_cloud_sandbox_organization_id",
            "organization_id",
            postgresql_where=text("organization_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_scope: Mapped[str] = mapped_column(String(32), default="personal")
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=True,
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
    )
    billing_subject_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("billing_subject.id", ondelete="RESTRICT"),
        nullable=True,
    )
    display_name: Mapped[str | None] = mapped_column(Text, nullable=True)
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
