"""Cloud integration ORM models."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
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


class CloudIntegrationDefinition(Base):
    __tablename__ = "cloud_integration_definition"
    __table_args__ = (
        CheckConstraint("source IN ('seed', 'org_custom')", name="ck_cloud_integration_source"),
        CheckConstraint("transport IN ('http')", name="ck_cloud_integration_transport"),
        CheckConstraint(
            "implementation IN ('upstream_mcp', 'virtual_proliferate_mcp')",
            name="ck_cloud_integration_implementation",
        ),
        CheckConstraint(
            "(source = 'seed' AND organization_id IS NULL) OR "
            "(source = 'org_custom' AND organization_id IS NOT NULL)",
            name="ck_cloud_integration_definition_source_scope",
        ),
        Index(
            "uq_cloud_integration_definition_seed_key",
            "key",
            unique=True,
            postgresql_where=text("source = 'seed'"),
        ),
        Index(
            "uq_cloud_integration_definition_org_key",
            "organization_id",
            "key",
            unique=True,
            postgresql_where=text("source = 'org_custom'"),
        ),
        Index("ix_cloud_integration_definition_organization_id", "organization_id"),
        Index("ix_cloud_integration_definition_namespace", "namespace"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(128), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=True,
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
    )
    source_version: Mapped[int] = mapped_column(Integer, default=1)
    content_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    namespace: Mapped[str] = mapped_column(String(128), nullable=False)
    provider_group: Mapped[str | None] = mapped_column(String(128), nullable=True)
    transport: Mapped[str] = mapped_column(String(32), default="http")
    implementation: Mapped[str] = mapped_column(String(64), default="upstream_mcp")
    config_json: Mapped[str] = mapped_column(Text, default="{}")
    enabled_by_default: Mapped[bool] = mapped_column(Boolean, default=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudIntegrationAccount(Base):
    __tablename__ = "cloud_integration_account"
    __table_args__ = (
        CheckConstraint(
            (
                "(owner_scope = 'personal' AND owner_user_id IS NOT NULL "
                "AND organization_id IS NULL) OR "
                "(owner_scope = 'organization' AND organization_id IS NOT NULL "
                "AND owner_user_id IS NULL)"
            ),
            name="ck_cloud_integration_account_owner",
        ),
        CheckConstraint(
            "owner_scope IN ('personal', 'organization')",
            name="ck_cloud_integration_account_owner_scope",
        ),
        CheckConstraint(
            "auth_kind IN ('oauth2', 'api_key', 'none')",
            name="ck_cloud_integration_account_auth_kind",
        ),
        CheckConstraint(
            "status IN ('ready', 'setup_required', 'reauth_required', 'error', 'disabled')",
            name="ck_cloud_integration_account_status",
        ),
        Index(
            "uq_cloud_integration_account_personal_definition",
            "owner_user_id",
            "definition_id",
            unique=True,
            postgresql_where=text("owner_scope = 'personal'"),
        ),
        Index(
            "uq_cloud_integration_account_org_definition",
            "organization_id",
            "definition_id",
            unique=True,
            postgresql_where=text("owner_scope = 'organization'"),
        ),
        Index("ix_cloud_integration_account_definition_id", "definition_id"),
        Index("ix_cloud_integration_account_owner_user_id", "owner_user_id"),
        Index("ix_cloud_integration_account_organization_id", "organization_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_scope: Mapped[str] = mapped_column(String(32), nullable=False)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        nullable=True,
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=True,
    )
    definition_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_integration_definition.id", ondelete="CASCADE"),
        nullable=False,
    )
    auth_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    settings_json: Mapped[str] = mapped_column(Text, default="{}")
    credential_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    auth_version: Mapped[int] = mapped_column(Integer, default=1)
    token_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudIntegrationOAuthClient(Base):
    __tablename__ = "cloud_integration_oauth_client"
    __table_args__ = (
        UniqueConstraint(
            "definition_id",
            "issuer",
            "redirect_uri",
            "resource",
            name="uq_cloud_integration_oauth_client_definition_issuer",
        ),
        CheckConstraint(
            "client_strategy IN ('dcr', 'client_metadata_document', 'static')",
            name="ck_cloud_integration_oauth_client_strategy",
        ),
        Index("ix_cloud_integration_oauth_client_definition_id", "definition_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    definition_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_integration_definition.id", ondelete="CASCADE"),
        nullable=False,
    )
    issuer: Mapped[str] = mapped_column(Text, nullable=False)
    redirect_uri: Mapped[str] = mapped_column(Text, nullable=False)
    resource: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_strategy: Mapped[str] = mapped_column(String(64), nullable=False)
    client_id: Mapped[str] = mapped_column(Text, nullable=False)
    client_secret_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    registration_metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    token_endpoint_auth_method: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudIntegrationOAuthFlow(Base):
    __tablename__ = "cloud_integration_oauth_flow"
    __table_args__ = (
        CheckConstraint(
            "callback_surface IN ('desktop', 'web')",
            name="ck_cloud_integration_oauth_flow_callback_surface",
        ),
        CheckConstraint(
            "final_surface IN ('desktop', 'web')",
            name="ck_cloud_integration_oauth_flow_final_surface",
        ),
        Index("ix_cloud_integration_oauth_flow_account_id", "account_id"),
        Index("ix_cloud_integration_oauth_flow_state_hash", "state_hash"),
        Index("ix_cloud_integration_oauth_flow_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_integration_account.id", ondelete="SET NULL"),
        nullable=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    state_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    code_verifier_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    issuer: Mapped[str | None] = mapped_column(Text, nullable=True)
    resource: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_id: Mapped[str] = mapped_column(Text, nullable=False)
    client_strategy: Mapped[str] = mapped_column(String(64), nullable=False)
    token_endpoint: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_scopes: Mapped[str] = mapped_column(Text, default="[]")
    redirect_uri: Mapped[str] = mapped_column(Text, nullable=False)
    authorization_url: Mapped[str] = mapped_column(Text, nullable=False)
    callback_surface: Mapped[str] = mapped_column(String(32), default="desktop")
    final_surface: Mapped[str] = mapped_column(String(32), default="desktop")
    return_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudIntegrationToolSchemaCache(Base):
    __tablename__ = "cloud_integration_tool_schema_cache"
    __table_args__ = (
        UniqueConstraint("account_id", "cache_key", name="uq_cloud_integration_tool_cache_key"),
        Index("ix_cloud_integration_tool_schema_cache_account_id", "account_id"),
        Index("ix_cloud_integration_tool_schema_cache_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_integration_account.id", ondelete="CASCADE"),
        nullable=False,
    )
    cache_key: Mapped[str] = mapped_column(String(255), nullable=False)
    tools_json: Mapped[str] = mapped_column(Text, default="[]")
    status: Mapped[str] = mapped_column(String(32), default="stale")
    refreshed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudIntegrationPolicy(Base):
    __tablename__ = "cloud_integration_policy"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "definition_id",
            name="uq_cloud_integration_policy_definition",
        ),
        Index("ix_cloud_integration_policy_organization_id", "organization_id"),
        Index("ix_cloud_integration_policy_definition_id", "definition_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    definition_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_integration_definition.id", ondelete="CASCADE"),
        nullable=False,
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
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
