"""Cloud workspace claim ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudWorkspaceClaim(Base):
    __tablename__ = "cloud_workspace_claim"
    __table_args__ = (
        CheckConstraint(
            "source_kind IN ('slack', 'automation', 'api', 'manual')",
            name="ck_cloud_workspace_claim_source_kind",
        ),
        UniqueConstraint("cloud_workspace_id", name="uq_cloud_workspace_claim_workspace"),
        Index("ix_cloud_workspace_claim_organization", "organization_id"),
        Index("ix_cloud_workspace_claim_claimed_by", "claimed_by_user_id"),
        Index("ix_cloud_workspace_claim_target", "target_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    cloud_workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_workspace.id", ondelete="CASCADE"),
    )
    exposure_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_workspace_exposure.id", ondelete="CASCADE"),
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
    )
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
    )
    anyharness_workspace_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    cloud_session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_sessions.id", ondelete="SET NULL"),
        nullable=True,
    )
    anyharness_session_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    claimed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
    )
    source_kind: Mapped[str] = mapped_column(String(32))
    claimed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CloudWorkspaceClaimToken(Base):
    __tablename__ = "cloud_workspace_claim_token"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'expired', 'revoked')",
            name="ck_cloud_workspace_claim_token_status",
        ),
        UniqueConstraint("token_jti_hash", name="uq_cloud_workspace_claim_token_jti_hash"),
        Index("ix_cloud_workspace_claim_token_claim_status", "claim_id", "status"),
        Index("ix_cloud_workspace_claim_token_target", "target_id"),
        Index("ix_cloud_workspace_claim_token_issued_to", "issued_to_user_id"),
        Index("ix_cloud_workspace_claim_token_expires", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    claim_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_workspace_claim.id", ondelete="CASCADE"),
    )
    token_jti_hash: Mapped[str] = mapped_column(String(64))
    hash_key_id: Mapped[str] = mapped_column(String(64))
    token_jti_prefix: Mapped[str | None] = mapped_column(String(12), nullable=True)
    issued_to_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
    )
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
    )
    anyharness_workspace_id: Mapped[str] = mapped_column(Text)
    anyharness_session_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    permissions: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="active")
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
