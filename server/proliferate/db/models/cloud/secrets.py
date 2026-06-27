"""Cloud secret ORM models."""

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


class CloudSecretSet(Base):
    __tablename__ = "cloud_secret_set"
    __table_args__ = (
        CheckConstraint(
            "scope_kind IN ('personal', 'organization', 'workspace')",
            name="ck_cloud_secret_set_scope_kind",
        ),
        CheckConstraint(
            "((scope_kind = 'personal' AND user_id IS NOT NULL "
            "AND organization_id IS NULL AND cloud_repo_config_id IS NULL "
            "AND repo_environment_id IS NULL) OR "
            "(scope_kind = 'organization' AND organization_id IS NOT NULL "
            "AND user_id IS NULL AND cloud_repo_config_id IS NULL "
            "AND repo_environment_id IS NULL) OR "
            "(scope_kind = 'workspace' AND repo_environment_id IS NOT NULL "
            "AND user_id IS NULL AND organization_id IS NULL))",
            name="ck_cloud_secret_set_scope_fields",
        ),
        Index(
            "ux_cloud_secret_set_personal",
            "user_id",
            unique=True,
            postgresql_where=text("scope_kind = 'personal'"),
        ),
        Index(
            "ux_cloud_secret_set_organization",
            "organization_id",
            unique=True,
            postgresql_where=text("scope_kind = 'organization'"),
        ),
        Index(
            "ux_cloud_secret_set_workspace_environment",
            "repo_environment_id",
            unique=True,
            postgresql_where=text("scope_kind = 'workspace'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    scope_kind: Mapped[str] = mapped_column(String(32), index=True)
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
    cloud_repo_config_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_repo_config.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    repo_environment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("repo_environment.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    version: Mapped[int] = mapped_column(Integer, default=0)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudSecretEnvVar(Base):
    __tablename__ = "cloud_secret_env_var"
    __table_args__ = (UniqueConstraint("secret_set_id", "name"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    secret_set_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_secret_set.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255))
    value_ciphertext: Mapped[str] = mapped_column(Text)
    value_sha256: Mapped[str] = mapped_column(String(64))
    byte_size: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudSecretFile(Base):
    __tablename__ = "cloud_secret_file"
    __table_args__ = (UniqueConstraint("secret_set_id", "path"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    secret_set_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_secret_set.id", ondelete="CASCADE"),
        index=True,
    )
    path: Mapped[str] = mapped_column(Text)
    content_ciphertext: Mapped[str] = mapped_column(Text)
    content_sha256: Mapped[str] = mapped_column(String(64))
    byte_size: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class ManagedSandboxSecretMaterialization(Base):
    __tablename__ = "managed_sandbox_secret_materialization"
    __table_args__ = (
        CheckConstraint(
            "materialization_kind IN ('global', 'workspace')",
            name="ck_managed_sandbox_secret_materialization_kind",
        ),
        CheckConstraint(
            "status IN ('pending', 'running', 'ready', 'error')",
            name="ck_managed_sandbox_secret_materialization_status",
        ),
        CheckConstraint(
            "((materialization_kind = 'global' "
            "AND cloud_repo_config_id IS NULL "
            "AND repo_environment_id IS NULL) OR "
            "(materialization_kind = 'workspace' AND repo_environment_id IS NOT NULL))",
            name="ck_managed_sandbox_secret_materialization_scope",
        ),
        Index(
            "ux_managed_sandbox_secret_materialization_global",
            "managed_sandbox_id",
            unique=True,
            postgresql_where=text("materialization_kind = 'global'"),
        ),
        Index(
            "ux_managed_sandbox_secret_materialization_workspace_environment",
            "managed_sandbox_id",
            "repo_environment_id",
            unique=True,
            postgresql_where=text("materialization_kind = 'workspace'"),
        ),
        Index(
            "ix_managed_sandbox_secret_materialization_status",
            "managed_sandbox_id",
            "status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    managed_sandbox_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("managed_sandbox.id", ondelete="CASCADE"),
        index=True,
    )
    materialization_kind: Mapped[str] = mapped_column(String(32), index=True)
    cloud_secret_set_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_secret_set.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    cloud_repo_config_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_repo_config.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    repo_environment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("repo_environment.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    sandbox_generation: Mapped[int] = mapped_column(Integer, default=0)
    applied_version: Mapped[int] = mapped_column(Integer, default=0)
    applied_versions_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    applied_manifest_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32))
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    materialized_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
