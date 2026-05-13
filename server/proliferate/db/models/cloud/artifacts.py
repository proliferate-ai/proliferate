"""Cloud artifact reference ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudArtifactRef(Base):
    __tablename__ = "cloud_artifact_ref"
    __table_args__ = (
        Index("ix_cloud_artifact_ref_retention", "org_id", "retention_expires_at"),
        Index("ix_cloud_artifact_ref_workspace_session", "workspace_id", "session_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(index=True)
    target_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    session_id: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)
    event_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    kind: Mapped[str] = mapped_column(String(64))
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size_bytes: Mapped[int] = mapped_column(default=0)
    storage_uri: Mapped[str] = mapped_column(Text)
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    retention_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
