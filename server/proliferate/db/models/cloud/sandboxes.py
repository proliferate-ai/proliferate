"""Cloud sandbox ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudSandbox(Base):
    __tablename__ = "cloud_sandbox"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    runtime_environment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_runtime_environment.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    # Compatibility-only during migration away from workspace-owned sandboxes.
    cloud_workspace_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)

    provider: Mapped[str] = mapped_column(String(32))
    external_sandbox_id: Mapped[str | None] = mapped_column(
        String(255),
        unique=True,
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(32))
    template_version: Mapped[str] = mapped_column(String(64))
    last_provider_event_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_provider_event_kind: Mapped[str | None] = mapped_column(String(64), nullable=True)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
