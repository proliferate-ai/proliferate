"""Integration definition, policy, account, and OAuth models.

Consolidates the old split MCP catalog / connection / connection-auth /
oauth-flow / oauth-client design into first-class integration rows:

- ``cloud_integration_definition``  — a provider (seed or org-custom) with its
  MCP launch + auth config in ``config_json``.
- ``cloud_integration_policy``      — per-org enable/disable of a definition.
- ``cloud_integration_account``     — a user's authenticated instance of a
  definition (credential bundle + status), one row per (user, definition).
- ``cloud_integration_oauth_client``— a per-definition OAuth client (DCR or
  static) keyed by (issuer, redirect_uri, definition).
- ``cloud_integration_oauth_flow``  — an in-flight OAuth authorization.
- ``cloud_integration_tool_schema_cache`` — cached ``tools/list`` for an account.

Credential/secret material is only ever stored encrypted (Fernet); the plain
values never hit these tables.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudIntegrationDefinition(Base):
    __tablename__ = "cloud_integration_definition"
    __table_args__ = (
        CheckConstraint(
            "source IN ('seed', 'org_custom')",
            name="ck_cloud_integration_definition_source",
        ),
        CheckConstraint(
            "auth_kind IN ('oauth2', 'api_key', 'none')",
            name="ck_cloud_integration_definition_auth_kind",
        ),
        CheckConstraint(
            "(source = 'seed' AND organization_id IS NULL) OR "
            "(source = 'org_custom' AND organization_id IS NOT NULL)",
            name="ck_cloud_integration_definition_source_owner",
        ),
        # One seed definition per namespace; org customs unique per org.
        Index(
            "ux_cloud_integration_definition_seed_namespace",
            "namespace",
            unique=True,
            postgresql_where="source = 'seed'",
        ),
        Index(
            "ux_cloud_integration_definition_org_namespace",
            "organization_id",
            "namespace",
            unique=True,
            postgresql_where="source = 'org_custom'",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    source: Mapped[str] = mapped_column(String(32))
    namespace: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    auth_kind: Mapped[str] = mapped_column(String(32))
    oauth_client_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Rendered launch + auth config (transport, url template, header/query
    # templates, secret + settings field schemas). See integrations config codec.
    config_json: Mapped[str] = mapped_column(Text, default="{}")
    enabled_by_default: Mapped[bool] = mapped_column(Boolean, default=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class CloudIntegrationPolicy(Base):
    __tablename__ = "cloud_integration_policy"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "definition_id",
            name="uq_cloud_integration_policy_org_definition",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(index=True)
    definition_id: Mapped[uuid.UUID] = mapped_column(index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # L25 admin key: the org-level scope this definition is allowed to expose to a
    # worker's gateway token (a tool-name allowlist, ``["claim", ...]``). NULL means
    # "no scope restriction from policy" — the admin surface for the worker-level
    # allowlist, extending this row rather than a parallel table. Not wired into
    # gateway enforcement in A–E (enforcement reads the worker token's scope_json);
    # kept nullable so it can be authored without touching existing rows.
    scope_json: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    updated_by_user_id: Mapped[uuid.UUID] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class CloudIntegrationAccount(Base):
    __tablename__ = "cloud_integration_account"
    __table_args__ = (
        CheckConstraint(
            "owner_scope IN ('personal', 'organization')",
            name="ck_cloud_integration_account_owner_scope",
        ),
        CheckConstraint(
            "status IN ('setup_required', 'ready', 'error')",
            name="ck_cloud_integration_account_status",
        ),
        CheckConstraint(
            "auth_kind IN ('oauth2', 'api_key', 'none')",
            name="ck_cloud_integration_account_auth_kind",
        ),
        UniqueConstraint(
            "owner_user_id",
            "definition_id",
            name="uq_cloud_integration_account_owner_definition",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    definition_id: Mapped[uuid.UUID] = mapped_column(index=True)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    # 'personal' today; column reserved for future org-shared accounts.
    owner_scope: Mapped[str] = mapped_column(String(32), default="personal")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(32), default="setup_required")
    auth_kind: Mapped[str] = mapped_column(String(32))
    credential_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    credential_format: Mapped[str] = mapped_column(String(64), default="json-v1")
    auth_version: Mapped[int] = mapped_column(Integer, default=1)
    settings_json: Mapped[str] = mapped_column(Text, default="{}")
    token_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class CloudIntegrationOAuthClient(Base):
    __tablename__ = "cloud_integration_oauth_client"
    __table_args__ = (
        UniqueConstraint(
            "issuer",
            "redirect_uri",
            "definition_id",
            name="uq_cloud_integration_oauth_client_key",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    definition_id: Mapped[uuid.UUID] = mapped_column(index=True)
    issuer: Mapped[str] = mapped_column(Text)
    redirect_uri: Mapped[str] = mapped_column(Text)
    resource: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_id: Mapped[str] = mapped_column(String(512))
    client_secret_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_secret_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    token_endpoint_auth_method: Mapped[str | None] = mapped_column(String(128), nullable=True)
    registration_client_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    registration_access_token_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
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
        CheckConstraint(
            "status IN ('active', 'exchanging', 'completed', 'expired', 'cancelled', 'failed')",
            name="ck_cloud_integration_oauth_flow_status",
        ),
        Index("ix_cloud_integration_oauth_flow_state_hash", "state_hash"),
        Index("ix_cloud_integration_oauth_flow_expires_at", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    definition_id: Mapped[uuid.UUID] = mapped_column(index=True)
    state_hash: Mapped[str] = mapped_column(String(128))
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
    status: Mapped[str] = mapped_column(String(32), default="active")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class CloudIntegrationToolSchemaCache(Base):
    __tablename__ = "cloud_integration_tool_schema_cache"
    __table_args__ = (
        CheckConstraint(
            "status IN ('ready', 'stale', 'error')",
            name="ck_cloud_integration_tool_schema_cache_status",
        ),
    )

    account_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    # Snapshot of the account's auth_version the cache was fetched under; a
    # mismatch means the cache is stale and must be refreshed.
    auth_version: Mapped[int] = mapped_column(Integer, default=0)
    tools_json: Mapped[str] = mapped_column(Text, default="[]")
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="stale")
    fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
