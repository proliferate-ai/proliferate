"""Cloud projection ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudProjectionSnapshot(Base):
    __tablename__ = "cloud_projection_snapshot"
    __table_args__ = (
        UniqueConstraint("projection_kind", "projection_id", name="uq_cloud_projection_identity"),
        Index("ix_cloud_projection_org_updated", "org_id", "updated_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(index=True)
    projection_kind: Mapped[str] = mapped_column(String(64))
    projection_id: Mapped[str] = mapped_column(String(255))
    target_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    session_id: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)
    cursor: Mapped[str | None] = mapped_column(String(255), nullable=True)
    snapshot_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
