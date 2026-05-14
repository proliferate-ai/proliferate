"""Cloud runtime environment ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudRuntimeEnvironment(Base):
    __tablename__ = "cloud_runtime_environment"
    __table_args__ = (
        Index(
            "uq_cloud_runtime_environment_user_repo_policy",
            "user_id",
            "git_provider",
            "git_owner_norm",
            "git_repo_name_norm",
            "isolation_policy",
            unique=True,
            postgresql_where=text("organization_id IS NULL"),
        ),
        Index(
            "uq_cloud_runtime_environment_org_repo_policy",
            "organization_id",
            "git_provider",
            "git_owner_norm",
            "git_repo_name_norm",
            "isolation_policy",
            unique=True,
            postgresql_where=text("organization_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    billing_subject_id: Mapped[uuid.UUID] = mapped_column(index=True)

    git_provider: Mapped[str] = mapped_column(String(32))
    git_owner: Mapped[str] = mapped_column(String(255))
    git_repo_name: Mapped[str] = mapped_column(String(255))
    git_owner_norm: Mapped[str] = mapped_column(String(255))
    git_repo_name_norm: Mapped[str] = mapped_column(String(255))
    isolation_policy: Mapped[str] = mapped_column(String(32), default="repo_shared")

    status: Mapped[str] = mapped_column(String(32), default="pending")
    active_sandbox_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    target_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    runtime_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    runtime_token_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    anyharness_data_key_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    root_anyharness_workspace_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    root_anyharness_repo_root_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    runtime_generation: Mapped[int] = mapped_column(Integer, default=0)
    credential_snapshot_version: Mapped[int] = mapped_column(Integer, default=0)
    credential_files_applied_revision: Mapped[str | None] = mapped_column(Text, nullable=True)
    credential_files_applied_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    credential_process_applied_revision: Mapped[str | None] = mapped_column(Text, nullable=True)
    credential_process_applied_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    credential_last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    credential_last_error_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    repo_env_applied_version: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
