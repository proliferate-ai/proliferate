"""Cloud artifact reference ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudArtifactRef(Base):
    __tablename__ = "cloud_artifact_refs"
    __table_args__ = (
        Index("ix_cloud_artifact_refs_org_retention", "org_id", "retention_expires_at"),
        Index("ix_cloud_artifact_refs_workspace_session", "workspace_id", "session_id"),
        CheckConstraint(
            "retention_state IN ('active', 'pinned', 'expired', 'deleted')",
            name="ck_cloud_artifact_refs_retention_state",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(index=True)
    target_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    session_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    event_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    artifact_kind: Mapped[str] = mapped_column(String(64))
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    byte_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    storage_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    storage_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    retention_state: Mapped[str] = mapped_column(String(32), default="active")
    retention_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
