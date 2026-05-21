"""Cloud repo configuration ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudRepoConfig(Base):
    __tablename__ = "cloud_repo_config"
    __table_args__ = (
        CheckConstraint(
            "owner_scope IN ('personal', 'organization')",
            name="ck_cloud_repo_config_owner_scope",
        ),
        CheckConstraint(
            "((owner_scope = 'personal' AND user_id IS NOT NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'organization' AND organization_id IS NOT NULL "
            "AND user_id IS NULL))",
            name="ck_cloud_repo_config_owner_fields",
        ),
        Index(
            "ux_cloud_repo_config_personal_repo",
            "user_id",
            "git_owner",
            "git_repo_name",
            unique=True,
            postgresql_where=text("owner_scope = 'personal'"),
        ),
        Index(
            "ux_cloud_repo_config_organization_repo",
            "organization_id",
            "git_owner",
            "git_repo_name",
            unique=True,
            postgresql_where=text("owner_scope = 'organization'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_scope: Mapped[str] = mapped_column(
        String(32),
        default="personal",
        server_default=text("'personal'"),
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    git_owner: Mapped[str] = mapped_column(String(255))
    git_repo_name: Mapped[str] = mapped_column(String(255))
    configured: Mapped[bool] = mapped_column(default=False)
    configured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    default_branch: Mapped[str | None] = mapped_column(String(255), nullable=True)
    env_vars_ciphertext: Mapped[str] = mapped_column(Text, default="")
    env_vars_version: Mapped[int] = mapped_column(Integer, default=0)
    setup_script: Mapped[str] = mapped_column(Text, default="")
    setup_script_version: Mapped[int] = mapped_column(Integer, default=0)
    run_command: Mapped[str] = mapped_column(Text, default="")
    files_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudRepoFile(Base):
    __tablename__ = "cloud_repo_file"
    __table_args__ = (UniqueConstraint("cloud_repo_config_id", "relative_path"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    cloud_repo_config_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_repo_config.id", ondelete="CASCADE"),
        index=True,
    )
    relative_path: Mapped[str] = mapped_column(String(1024))
    content_ciphertext: Mapped[str] = mapped_column(Text)
    content_sha256: Mapped[str] = mapped_column(String(64))
    byte_size: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    last_synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
