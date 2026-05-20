"""Sandbox profile runtime-config ORM models."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class SandboxProfileRuntimeConfigRevision(Base):
    __tablename__ = "sandbox_profile_runtime_config_revision"
    __table_args__ = (
        UniqueConstraint(
            "sandbox_profile_id",
            "sequence",
            name="uq_runtime_config_revision_profile_sequence",
        ),
        UniqueConstraint(
            "sandbox_profile_id",
            "content_hash",
            name="uq_runtime_config_revision_profile_hash",
        ),
        Index(
            "ix_runtime_config_revision_profile_created",
            "sandbox_profile_id",
            "created_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sandbox_profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sandbox_profile.id", ondelete="CASCADE"),
        index=True,
    )
    sequence: Mapped[int] = mapped_column(Integer)
    content_hash: Mapped[str] = mapped_column(String(128))
    manifest_json: Mapped[str] = mapped_column(Text)
    warnings_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(32), default="server")
    generated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SandboxProfileRuntimeConfigCurrent(Base):
    __tablename__ = "sandbox_profile_runtime_config_current"

    sandbox_profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sandbox_profile.id", ondelete="CASCADE"),
        primary_key=True,
    )
    current_sequence: Mapped[int] = mapped_column(Integer, default=0)
    current_revision_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sandbox_profile_runtime_config_revision.id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class SandboxProfileRuntimeConfigArtifact(Base):
    __tablename__ = "sandbox_profile_runtime_config_artifact"

    revision_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sandbox_profile_runtime_config_revision.id", ondelete="CASCADE"),
        primary_key=True,
    )
    artifact_hash: Mapped[str] = mapped_column(String(128), primary_key=True)
    content_type: Mapped[str] = mapped_column(String(255))
    byte_size: Mapped[int] = mapped_column(Integer)
    payload_ciphertext: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
