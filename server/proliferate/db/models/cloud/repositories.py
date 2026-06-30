"""Repository and environment ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.constants.cloud import GitProvider, RepoEnvironmentKind
from proliferate.db.models.base import Base, utcnow

_GIT_PROVIDER_ENUM = Enum(
    GitProvider,
    name="git_provider",
    native_enum=False,
    values_callable=lambda values: [value.value for value in values],
    validate_strings=True,
)
_REPO_ENVIRONMENT_KIND_ENUM = Enum(
    RepoEnvironmentKind,
    name="repo_environment_kind",
    native_enum=False,
    values_callable=lambda values: [value.value for value in values],
    validate_strings=True,
)


class RepoConfig(Base):
    __tablename__ = "repo_config"
    __table_args__ = (
        CheckConstraint(
            "git_provider IN ('github')",
            name="ck_repo_config_git_provider",
        ),
        Index(
            "ux_repo_config_user_repo",
            "user_id",
            "git_provider",
            "git_owner",
            "git_repo_name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    git_provider: Mapped[GitProvider] = mapped_column(
        _GIT_PROVIDER_ENUM,
        default=GitProvider.github,
    )
    git_owner: Mapped[str] = mapped_column(String(255))
    git_repo_name: Mapped[str] = mapped_column(String(255))
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
    environment_kind: Mapped[RepoEnvironmentKind] = mapped_column(
        _REPO_ENVIRONMENT_KIND_ENUM,
        index=True,
    )
    desktop_install_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    local_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_branch: Mapped[str | None] = mapped_column(String(255), nullable=True)
    setup_script: Mapped[str] = mapped_column(Text, default="")
    run_command: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
