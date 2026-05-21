"""Cloud plugin configured-item ORM models."""

from __future__ import annotations

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
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudPluginConfiguredItem(Base):
    __tablename__ = "cloud_plugin_configured_item"
    __table_args__ = (
        CheckConstraint(
            (
                "(owner_scope = 'personal' AND owner_user_id IS NOT NULL "
                "AND organization_id IS NULL) OR "
                "(owner_scope = 'organization' AND organization_id IS NOT NULL "
                "AND owner_user_id IS NULL)"
            ),
            name="ck_plugin_configured_owner_fields",
        ),
        CheckConstraint(
            (
                "(public_to_org = false AND public_organization_id IS NULL) OR "
                "(public_to_org = true AND public_organization_id IS NOT NULL)"
            ),
            name="ck_plugin_configured_public",
        ),
        CheckConstraint(
            "owner_scope IN ('personal', 'organization')",
            name="ck_plugin_configured_owner_scope",
        ),
        CheckConstraint(
            "public_status IN ('private', 'public', 'blocked', 'stale', 'revoked')",
            name="ck_plugin_configured_public_status",
        ),
        Index(
            "uq_plugin_configured_personal_plugin",
            "owner_user_id",
            "plugin_id",
            unique=True,
            postgresql_where=text("owner_scope = 'personal'"),
        ),
        Index(
            "uq_plugin_configured_org_plugin",
            "organization_id",
            "plugin_id",
            unique=True,
            postgresql_where=text("owner_scope = 'organization'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_scope: Mapped[str] = mapped_column(String(32))
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
    plugin_id: Mapped[str] = mapped_column(String(255))
    plugin_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    public_to_org: Mapped[bool] = mapped_column(Boolean, default=False)
    public_organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    public_status: Mapped[str] = mapped_column(String(32), default="private")
    public_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    public_updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
    )
    config_version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
