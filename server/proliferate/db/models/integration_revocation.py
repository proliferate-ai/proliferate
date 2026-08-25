"""Bounded encrypted revocation work retained after local disconnect."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Index, Integer, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base
from proliferate.lib.infra.time.wall_clock import utcnow


class CloudIntegrationRevocationJob(Base):
    """A secret-destroying provider revocation receipt and retry state."""

    __tablename__ = "cloud_integration_revocation_job"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'running', 'succeeded', 'unsupported', 'exhausted')",
            name="ck_cloud_integration_revocation_job_status",
        ),
        CheckConstraint(
            "attempt_count >= 0",
            name="ck_cloud_integration_revocation_job_attempt_count",
        ),
        CheckConstraint(
            "(status IN ('pending', 'running') AND credential_ciphertext IS NOT NULL "
            "AND completed_at IS NULL) OR "
            "(status IN ('succeeded', 'unsupported', 'exhausted') "
            "AND credential_ciphertext IS NULL AND completed_at IS NOT NULL)",
            name="ck_cloud_integration_revocation_job_secret_lifecycle",
        ),
        Index(
            "ix_cloud_integration_revocation_job_status_deadline",
            "status",
            "deadline_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    account_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    definition_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    provider_namespace: Mapped[str] = mapped_column(String(64), nullable=False)
    provider_client_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    credential_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    credential_format: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    deadline_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_attempt_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        server_default=func.now(),
        onupdate=func.now(),
    )
