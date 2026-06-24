"""Auth-domain ORM models: User, OAuthAccount, DesktopAuthCode."""

import uuid
from datetime import datetime

from fastapi_users_db_sqlalchemy import (
    SQLAlchemyBaseOAuthAccountTableUUID,
    SQLAlchemyBaseUserTableUUID,
)
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
from sqlalchemy.orm import Mapped, mapped_column, relationship

from proliferate.db.models.base import Base, utcnow


class OAuthAccount(SQLAlchemyBaseOAuthAccountTableUUID, Base):
    pass


class User(SQLAlchemyBaseUserTableUUID, Base):
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    github_login: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    password_set_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    oauth_accounts: Mapped[list[OAuthAccount]] = relationship("OAuthAccount", lazy="selectin")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
    )
    customerio_welcome_sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )


class DesktopAuthCode(Base):
    """Short-lived authorization code for the desktop PKCE flow.

    Created when a user completes browser auth, consumed when the desktop
    app exchanges it for a JWT via POST /auth/desktop/token.
    """

    __tablename__ = "desktop_auth_code"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column()
    code_challenge: Mapped[str] = mapped_column(String(128))
    code_challenge_method: Mapped[str] = mapped_column(String(10), default="S256")
    state: Mapped[str] = mapped_column(String(128))
    redirect_uri: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
    )
    consumed: Mapped[bool] = mapped_column(default=False)


class AuthIdentity(Base):
    """Canonical external provider identity linked to a Proliferate user."""

    __tablename__ = "auth_identity"
    __table_args__ = (
        UniqueConstraint("provider", "provider_subject", name="uq_auth_identity_provider_subject"),
        Index("ix_auth_identity_user_id", "user_id"),
        Index("ix_auth_identity_user_provider", "user_id", "provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(String(32))
    provider_subject: Mapped[str] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text, nullable=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    display_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    linked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class ProviderGrant(Base):
    """Encrypted provider access material and readiness state."""

    __tablename__ = "provider_grant"
    __table_args__ = (
        UniqueConstraint(
            "auth_identity_id",
            "provider",
            name="uq_provider_grant_identity_provider",
        ),
        Index("ix_provider_grant_user_provider", "user_id", "provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    auth_identity_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("auth_identity.id", ondelete="CASCADE")
    )
    provider: Mapped[str] = mapped_column(String(32))
    access_token_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    refresh_token_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    scopes_json: Mapped[str] = mapped_column(Text, default="[]")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="ready")
    last_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class AuthChallenge(Base):
    """Short-lived OAuth/OIDC challenge for browser and native auth flows."""

    __tablename__ = "auth_challenge"
    __table_args__ = (
        Index("ix_auth_challenge_state_hash", "state_hash"),
        Index("ix_auth_challenge_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    provider: Mapped[str] = mapped_column(String(32))
    surface: Mapped[str] = mapped_column(String(32))
    purpose: Mapped[str] = mapped_column(String(32))
    state_hash: Mapped[str] = mapped_column(String(128), unique=True)
    nonce_hash: Mapped[str] = mapped_column(String(128))
    csrf_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        nullable=True,
    )
    client_state: Mapped[str] = mapped_column(String(256))
    code_challenge: Mapped[str] = mapped_column(String(128))
    code_challenge_method: Mapped[str] = mapped_column(String(10), default="S256")
    redirect_uri: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SsoConnection(Base):
    """Organization or deployment SSO provider configuration."""

    __tablename__ = "sso_connection"
    __table_args__ = (
        CheckConstraint(
            "scope IN ('deployment', 'organization')",
            name="ck_sso_connection_scope",
        ),
        CheckConstraint(
            "protocol IN ('oidc', 'saml')",
            name="ck_sso_connection_protocol",
        ),
        CheckConstraint(
            "status IN ('draft', 'enabled', 'disabled')",
            name="ck_sso_connection_status",
        ),
        CheckConstraint(
            "login_policy IN ('optional', 'required')",
            name="ck_sso_connection_login_policy",
        ),
        CheckConstraint(
            "jit_policy IN ('disabled', 'existing_user', 'create_member')",
            name="ck_sso_connection_jit_policy",
        ),
        CheckConstraint(
            "default_role IN ('owner', 'admin', 'member')",
            name="ck_sso_connection_default_role",
        ),
        CheckConstraint(
            "((scope = 'organization' AND organization_id IS NOT NULL) OR "
            "(scope = 'deployment' AND organization_id IS NULL))",
            name="ck_sso_connection_scope_organization",
        ),
        Index("ix_sso_connection_organization_status", "organization_id", "status"),
        Index("ix_sso_connection_scope_status", "scope", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    scope: Mapped[str] = mapped_column(String(32), default="organization")
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=True,
    )
    protocol: Mapped[str] = mapped_column(String(16), default="oidc")
    status: Mapped[str] = mapped_column(
        String(32),
        default="draft",
        server_default=text("'draft'"),
    )
    display_name: Mapped[str] = mapped_column(String(255))
    login_policy: Mapped[str] = mapped_column(
        String(32),
        default="optional",
        server_default=text("'optional'"),
    )
    jit_policy: Mapped[str] = mapped_column(
        String(32),
        default="disabled",
        server_default=text("'disabled'"),
    )
    default_role: Mapped[str] = mapped_column(
        String(32),
        default="member",
        server_default=text("'member'"),
    )
    allowed_domains_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    oidc_issuer_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    oidc_discovery_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    oidc_authorization_endpoint: Mapped[str | None] = mapped_column(Text, nullable=True)
    oidc_token_endpoint: Mapped[str | None] = mapped_column(Text, nullable=True)
    oidc_jwks_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    oidc_userinfo_endpoint: Mapped[str | None] = mapped_column(Text, nullable=True)
    oidc_client_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    oidc_client_secret_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    oidc_scopes_json: Mapped[str] = mapped_column(
        Text,
        default='["openid","email","profile"]',
        server_default='["openid","email","profile"]',
    )
    oidc_token_endpoint_auth_method: Mapped[str] = mapped_column(
        String(64),
        default="client_secret_basic",
        server_default=text("'client_secret_basic'"),
    )
    saml_idp_metadata_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    saml_idp_metadata_xml_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    saml_idp_entity_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    saml_sso_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    saml_x509_cert_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    saml_email_attribute: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
    )
    tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class SsoChallenge(Base):
    """Short-lived SSO challenge keyed by state."""

    __tablename__ = "sso_challenge"
    __table_args__ = (
        CheckConstraint(
            "scope IN ('deployment', 'organization')",
            name="ck_sso_challenge_scope",
        ),
        CheckConstraint(
            "protocol IN ('oidc', 'saml')",
            name="ck_sso_challenge_protocol",
        ),
        Index("ix_sso_challenge_state_hash", "state_hash"),
        Index("ix_sso_challenge_connection_key", "connection_key"),
        Index("ix_sso_challenge_organization_id", "organization_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    scope: Mapped[str] = mapped_column(String(32))
    connection_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sso_connection.id", ondelete="CASCADE"),
        nullable=True,
    )
    connection_key: Mapped[str] = mapped_column(String(255))
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=True,
    )
    protocol: Mapped[str] = mapped_column(String(16))
    surface: Mapped[str] = mapped_column(String(32))
    purpose: Mapped[str] = mapped_column(String(32), default="login")
    state_hash: Mapped[str] = mapped_column(String(128), unique=True)
    nonce_hash: Mapped[str] = mapped_column(String(128))
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        nullable=True,
    )
    client_state: Mapped[str] = mapped_column(String(256))
    code_challenge: Mapped[str] = mapped_column(String(128))
    code_challenge_method: Mapped[str] = mapped_column(String(10), default="S256")
    redirect_uri: Mapped[str] = mapped_column(Text)
    login_hint: Mapped[str | None] = mapped_column(String(320), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SsoIdentity(Base):
    """A user identity proven by a specific SSO connection."""

    __tablename__ = "sso_identity"
    __table_args__ = (
        UniqueConstraint(
            "connection_key",
            "provider_subject",
            name="uq_sso_identity_connection_subject",
        ),
        CheckConstraint(
            "protocol IN ('oidc', 'saml')",
            name="ck_sso_identity_protocol",
        ),
        Index("ix_sso_identity_user_id", "user_id"),
        Index("ix_sso_identity_organization_id", "organization_id"),
        Index("ix_sso_identity_connection_id", "connection_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=True,
    )
    connection_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sso_connection.id", ondelete="CASCADE"),
        nullable=True,
    )
    connection_key: Mapped[str] = mapped_column(String(255))
    protocol: Mapped[str] = mapped_column(String(16))
    provider_subject: Mapped[str] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text, nullable=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=True)
    display_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    linked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class PasswordLoginAttempt(Base):
    """Per-bucket password login throttling state."""

    __tablename__ = "password_login_attempt"
    __table_args__ = (
        UniqueConstraint("bucket_kind", "bucket_key", name="uq_password_login_attempt_bucket"),
        Index("ix_password_login_attempt_blocked_until", "blocked_until"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    bucket_kind: Mapped[str] = mapped_column(String(32))
    bucket_key: Mapped[str] = mapped_column(String(128))
    failure_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    window_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    blocked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
