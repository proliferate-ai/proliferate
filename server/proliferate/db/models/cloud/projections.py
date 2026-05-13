"""Cloud projection snapshot ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudProjectionSnapshot(Base):
    __tablename__ = "cloud_projection_snapshots"
    __table_args__ = (
        Index(
            "uq_cloud_projection_snapshots_kind_id",
            "projection_kind",
            "projection_id",
            unique=True,
        ),
        Index("ix_cloud_projection_snapshots_org_updated", "org_id", "updated_at"),
        CheckConstraint(
            "projection_kind IN ('workspace', 'session', 'transcript', 'target')",
            name="ck_cloud_projection_snapshots_kind",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(index=True)
    projection_kind: Mapped[str] = mapped_column(String(32))
    projection_id: Mapped[uuid.UUID] = mapped_column(index=True)
    target_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    session_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    last_event_seq: Mapped[int] = mapped_column(BigInteger, default=0)
    snapshot: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
