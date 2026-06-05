"""Managed cloud target runtime-access ORM model."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudTargetRuntimeAccess(Base):
    __tablename__ = "cloud_target_runtime_access"
    __table_args__ = (
        UniqueConstraint("target_id", name="uq_cloud_target_runtime_access_target_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
    )
    sandbox_profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sandbox_profile.id", ondelete="CASCADE"),
        index=True,
    )
    cloud_sandbox_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_sandbox.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    anyharness_base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    runtime_token_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    anyharness_data_key_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_worker_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workers.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
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
