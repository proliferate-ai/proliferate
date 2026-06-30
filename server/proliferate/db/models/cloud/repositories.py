"""Repository and environment ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class RepoConfig(Base):
    __tablename__ = "repo_config"
    __table_args__ = (
        CheckConstraint(
            "owner_scope IN ('personal', 'organization')",
            name="ck_repo_config_owner_scope",
        ),
        CheckConstraint(
            "((owner_scope = 'personal' AND user_id IS NOT NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'organization' AND organization_id IS NOT NULL "
            "AND user_id IS NULL))",
            name="ck_repo_config_owner_fields",
        ),
        Index(
            "ux_repo_config_personal_repo",
            "user_id",
            "git_provider",
            "git_owner",
            "git_repo_name",
            unique=True,
            postgresql_where=text("owner_scope = 'personal' AND deleted_at IS NULL"),
        ),
        Index(
            "ux_repo_config_organization_repo",
            "organization_id",
            "git_provider",
            "git_owner",
            "git_repo_name",
            unique=True,
            postgresql_where=text("owner_scope = 'organization' AND deleted_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_scope: Mapped[str] = mapped_column(String(32), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    git_provider: Mapped[str] = mapped_column(String(32), default="github")
    git_owner: Mapped[str] = mapped_column(String(255))
    git_repo_name: Mapped[str] = mapped_column(String(255))
    legacy_cloud_repo_config_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_repo_config.id", ondelete="SET NULL"),
        unique=True,
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RepoEnvironment(Base):
    __tablename__ = "repo_environment"
    __table_args__ = (
        CheckConstraint(
            "environment_kind IN ('local', 'cloud')",
            name="ck_repo_environment_kind",
        ),
        CheckConstraint(
            "((environment_kind = 'local' AND local_path IS NOT NULL "
            "AND desktop_install_id IS NOT NULL) OR "
            "(environment_kind = 'cloud' AND local_path IS NULL))",
            name="ck_repo_environment_kind_fields",
        ),
        Index(
            "ux_repo_environment_cloud",
            "repo_config_id",
            unique=True,
            postgresql_where=text("environment_kind = 'cloud' AND deleted_at IS NULL"),
        ),
        Index(
            "ux_repo_environment_local_path",
            "repo_config_id",
            "desktop_install_id",
            "local_path",
            unique=True,
            postgresql_where=text("environment_kind = 'local' AND deleted_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    repo_config_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("repo_config.id", ondelete="CASCADE"),
        index=True,
    )
    environment_kind: Mapped[str] = mapped_column(String(32), index=True)
    desktop_install_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    local_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    configured: Mapped[bool] = mapped_column(default=False)
    configured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    default_branch: Mapped[str | None] = mapped_column(String(255), nullable=True)
    setup_script: Mapped[str] = mapped_column(Text, default="")
    setup_script_version: Mapped[int] = mapped_column(default=0)
    run_command: Mapped[str] = mapped_column(Text, default="")
    config_version: Mapped[int] = mapped_column(default=0)
    legacy_cloud_repo_config_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_repo_config.id", ondelete="SET NULL"),
        unique=True,
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
