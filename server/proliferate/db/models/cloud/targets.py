"""Cloud compute target ORM model (minimal direct-runtime reintroduction).

The #803/#809 cutover deleted the pre-cutover target registry wholesale. The
ssh/personal-target design (specs/tbd/ssh-personal-target-design.md §3.1)
brings the enrollment record back as the ownership anchor for per-target
agent-auth scoping: a ``CloudTarget`` row is a user-owned direct runtime that
target-scoped route selections reference. Only the ownership/identity columns
live here; enrollment transport state (workers, inventory, heartbeats,
bearer ciphertext) returns with the enrollment slice of the stack.
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.constants.cloud import (
    SUPPORTED_CLOUD_TARGET_KINDS,
    SUPPORTED_CLOUD_TARGET_STATUSES,
)
from proliferate.db.models.base import Base, utcnow


class CloudTarget(Base):
    __tablename__ = "cloud_targets"
    __table_args__ = (
        CheckConstraint(
            f"kind IN {SUPPORTED_CLOUD_TARGET_KINDS}",
            name="ck_cloud_targets_kind",
        ),
        CheckConstraint(
            "owner_scope IN ('personal', 'organization')",
            name="ck_cloud_targets_owner_scope",
        ),
        CheckConstraint(
            "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'organization' AND organization_id IS NOT NULL "
            "AND owner_user_id IS NULL))",
            name="ck_cloud_target_owner_fields",
        ),
        CheckConstraint(
            f"status IN {SUPPORTED_CLOUD_TARGET_STATUSES}",
            name="ck_cloud_targets_status",
        ),
        Index("ix_cloud_targets_owner_user_status", "owner_user_id", "status"),
        Index("ix_cloud_targets_organization_status", "organization_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    display_name: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="enrolling", index=True)
    owner_scope: Mapped[str] = mapped_column(String(32), default="personal")
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
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
