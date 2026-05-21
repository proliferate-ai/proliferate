"""Cloud workspace exposure ORM models."""

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
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudWorkspaceExposure(Base):
    __tablename__ = "cloud_workspace_exposure"
    __table_args__ = (
        CheckConstraint(
            "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'organization' AND organization_id IS NOT NULL "
            "AND owner_user_id IS NULL))",
            name="ck_cloud_workspace_exposure_owner_fields",
        ),
        CheckConstraint(
            "visibility IN ('private', 'shared_unclaimed', 'claimed', 'archived')",
            name="ck_cloud_workspace_exposure_visibility",
        ),
        CheckConstraint(
            "default_projection_level IN "
            "('index_only', 'session_summaries', 'transcript', 'live')",
            name="ck_cloud_workspace_exposure_projection_level",
        ),
        CheckConstraint(
            "claimed_by_user_id IS NULL OR visibility = 'claimed'",
            name="ck_cloud_workspace_exposure_claimed_user",
        ),
        CheckConstraint(
            "status IN ('active', 'paused', 'stale', 'revoked')",
            name="ck_cloud_workspace_exposure_status",
        ),
        CheckConstraint(
            "origin IS NULL OR origin IN ('manual_desktop', 'manual_web', "
            "'manual_mobile', 'automation', 'slack', 'cowork_api')",
            name="ck_cloud_workspace_exposure_origin",
        ),
        Index("ix_cloud_workspace_exposure_target", "target_id"),
        Index("ix_cloud_workspace_exposure_workspace", "cloud_workspace_id"),
        Index("ix_cloud_workspace_exposure_owner_user", "owner_user_id"),
        Index("ix_cloud_workspace_exposure_organization", "organization_id"),
        Index(
            "ux_cloud_workspace_exposure_active",
            "target_id",
            "cloud_workspace_id",
            unique=True,
            postgresql_where=text("archived_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
    )
    cloud_workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_workspace.id", ondelete="CASCADE"),
    )
    anyharness_workspace_id: Mapped[str | None] = mapped_column(Text, nullable=True)

    owner_scope: Mapped[str] = mapped_column(String(32))
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        nullable=True,
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=True,
    )

    visibility: Mapped[str] = mapped_column(String(32), default="private")
    claimed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
    )

    default_projection_level: Mapped[str] = mapped_column(String(32), default="live")
    commandable: Mapped[bool] = mapped_column(Boolean, default=True)

    status: Mapped[str] = mapped_column(String(32), default="active")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    last_projected_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    origin: Mapped[str | None] = mapped_column(String(32), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
