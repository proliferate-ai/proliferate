"""Cloud MCP ORM models."""

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


class CloudMcpConnection(Base):
    __tablename__ = "cloud_mcp_connection"
    __table_args__ = (
        CheckConstraint(
            (
                "(owner_scope = 'personal' AND owner_user_id IS NOT NULL "
                "AND organization_id IS NULL) OR "
                "(owner_scope = 'organization' AND organization_id IS NOT NULL "
                "AND owner_user_id IS NULL)"
            ),
            name="ck_cloud_mcp_connection_owner_fields",
        ),
        CheckConstraint(
            (
                "(public_to_org = false AND public_organization_id IS NULL) OR "
                "(public_to_org = true AND public_organization_id IS NOT NULL)"
            ),
            name="ck_cloud_mcp_connection_public",
        ),
        CheckConstraint(
            "owner_scope IN ('personal', 'organization')",
            name="ck_cloud_mcp_connection_owner_scope",
        ),
        CheckConstraint(
            "public_status IN ('private', 'public', 'blocked', 'stale', 'revoked')",
            name="ck_cloud_mcp_connection_public_status",
        ),
        Index(
            "uq_cloud_mcp_connection_personal_connection_id",
            "owner_user_id",
            "connection_id",
            unique=True,
            postgresql_where=text("owner_scope = 'personal'"),
        ),
        Index(
            "uq_cloud_mcp_connection_organization_connection_id",
            "organization_id",
            "connection_id",
            unique=True,
            postgresql_where=text("owner_scope = 'organization'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_scope: Mapped[str] = mapped_column(String(32), default="personal")
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    connection_id: Mapped[str] = mapped_column(String(255))
    catalog_entry_id: Mapped[str] = mapped_column(String(255))
    catalog_entry_version: Mapped[int] = mapped_column(Integer, default=1)
    server_name: Mapped[str] = mapped_column(String(255), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    public_to_org: Mapped[bool] = mapped_column(Boolean, default=False)
    public_organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    public_status: Mapped[str] = mapped_column(String(32), default="private")
    public_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    public_updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
    )
    settings_json: Mapped[str] = mapped_column(Text, default="{}")
    config_version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    last_synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CloudMcpConnectionAuth(Base):
    __tablename__ = "cloud_mcp_connection_auth"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    connection_db_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_mcp_connection.id", ondelete="CASCADE"),
        index=True,
        unique=True,
    )
    auth_kind: Mapped[str] = mapped_column(String(32))
    auth_status: Mapped[str] = mapped_column(String(32))
    payload_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_format: Mapped[str] = mapped_column(String(64), default="json-v1")
    auth_version: Mapped[int] = mapped_column(Integer, default=1)
    token_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudMcpOAuthFlow(Base):
    __tablename__ = "cloud_mcp_oauth_flow"
    __table_args__ = (
        CheckConstraint(
            "callback_surface IN ('desktop', 'web')",
            name="ck_cloud_mcp_oauth_flow_callback_surface",
        ),
        CheckConstraint(
            "final_surface IN ('desktop', 'web')",
            name="ck_cloud_mcp_oauth_flow_final_surface",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    connection_db_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_mcp_connection.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    state_hash: Mapped[str] = mapped_column(String(128), index=True)
    code_verifier_ciphertext: Mapped[str] = mapped_column(Text)
    issuer: Mapped[str | None] = mapped_column(Text, nullable=True)
    resource: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_id: Mapped[str] = mapped_column(String(512))
    token_endpoint: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_scopes: Mapped[str] = mapped_column(Text, default="[]")
    redirect_uri: Mapped[str] = mapped_column(Text)
    authorization_url: Mapped[str] = mapped_column(Text)
    callback_surface: Mapped[str] = mapped_column(String(32), default="desktop")
    final_surface: Mapped[str] = mapped_column(String(32), default="desktop")
    return_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudMcpOAuthClient(Base):
    __tablename__ = "cloud_mcp_oauth_client"
    __table_args__ = (UniqueConstraint("issuer", "redirect_uri", "catalog_entry_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    issuer: Mapped[str] = mapped_column(Text)
    redirect_uri: Mapped[str] = mapped_column(Text)
    catalog_entry_id: Mapped[str] = mapped_column(String(255))
    resource: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_id: Mapped[str] = mapped_column(String(512))
    client_secret_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_secret_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    token_endpoint_auth_method: Mapped[str | None] = mapped_column(String(128), nullable=True)
    registration_client_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    registration_access_token_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
