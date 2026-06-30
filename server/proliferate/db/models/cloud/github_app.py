"""GitHub App authorization and installation cache models."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class GitHubAppAuthorization(Base):
    __tablename__ = "github_app_authorizations"
    __table_args__ = (
        CheckConstraint(
            "status IN ('ready', 'expired', 'revoked', 'needs_reauth')",
            name="ck_github_app_authorizations_status",
        ),
        Index(
            "ux_github_app_authorizations_user_active",
            "user_id",
            unique=True,
            postgresql_where=text("status != 'revoked'"),
        ),
        Index("ix_github_app_authorizations_github_user", "github_user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    github_user_id: Mapped[str] = mapped_column(String(64), index=True)
    github_login: Mapped[str] = mapped_column(String(255))
    access_token_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    refresh_token_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    refresh_token_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(32), default="ready", index=True)
    permissions_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class GitHubAppInstallation(Base):
    __tablename__ = "github_app_installations"
    __table_args__ = (
        Index("ux_github_app_installations_external", "github_installation_id", unique=True),
        Index("ix_github_app_installations_account", "account_login", "account_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    github_installation_id: Mapped[str] = mapped_column(String(64), index=True)
    account_login: Mapped[str] = mapped_column(String(255), index=True)
    account_type: Mapped[str] = mapped_column(String(32))
    repository_selection: Mapped[str] = mapped_column(String(32))
    permissions_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class GitHubAppInstallationRepository(Base):
    __tablename__ = "github_app_installation_repositories"
    __table_args__ = (
        Index(
            "ux_github_app_installation_repositories_repo",
            "github_app_installation_id",
            "owner",
            "name",
            unique=True,
        ),
        Index("ix_github_app_installation_repositories_owner_name", "owner", "name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    github_app_installation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("github_app_installations.id", ondelete="CASCADE"),
        index=True,
    )
    owner: Mapped[str] = mapped_column(String(255), index=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    github_repository_id: Mapped[str] = mapped_column(String(64), index=True)
    private: Mapped[bool] = mapped_column(Boolean, default=True)
    default_branch: Mapped[str | None] = mapped_column(String(255), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
