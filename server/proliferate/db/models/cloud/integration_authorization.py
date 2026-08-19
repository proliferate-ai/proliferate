"""Integration authorization-attempt and security-revision models."""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base
from proliferate.lib.infra.time.wall_clock import utcnow


class CloudIntegrationDefinitionSecurityRevision(Base):
    """Immutable security-relevant snapshot of an integration definition."""

    __tablename__ = "cloud_integration_definition_security_revision"
    __table_args__ = (
        CheckConstraint(
            "revision > 0",
            name="ck_cloud_integration_definition_security_revision_positive",
        ),
        CheckConstraint(
            "auth_kind IN ('oauth2', 'api_key', 'none')",
            name="ck_cloud_integration_definition_security_revision_auth_kind",
        ),
        UniqueConstraint(
            "definition_id",
            "revision",
            name="uq_cloud_integration_definition_security_revision",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    definition_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_integration_definition.id", ondelete="CASCADE"),
        index=True,
    )
    revision: Mapped[int] = mapped_column(Integer)
    auth_kind: Mapped[str] = mapped_column(String(32))
    oauth_client_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    config_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CloudIntegrationAuthorizationAttempt(Base):
    """Temporary credential work; never itself an agent-usable connection."""

    __tablename__ = "cloud_integration_authorization_attempt"
    __table_args__ = (
        CheckConstraint(
            "purpose IN ('connect', 'reauthorize', 'rotate')",
            name="ck_cloud_integration_authorization_attempt_purpose",
        ),
        CheckConstraint(
            "method IN ('oauth2', 'api_key', 'none')",
            name="ck_cloud_integration_authorization_attempt_method",
        ),
        CheckConstraint(
            "status IN ('active', 'exchanging', 'validating', 'succeeded', "
            "'failed', 'cancelled', 'expired', 'superseded')",
            name="ck_cloud_integration_authorization_attempt_status",
        ),
        CheckConstraint(
            "generation > 0",
            name="ck_cloud_integration_authorization_attempt_generation_positive",
        ),
        CheckConstraint(
            "starting_grant_version IS NULL OR starting_grant_version > 0",
            name="ck_cloud_int_auth_attempt_grant_version_positive",
        ),
        CheckConstraint(
            "starting_credential_version IS NULL OR starting_credential_version > 0",
            name="ck_cloud_int_auth_attempt_credential_version_positive",
        ),
        CheckConstraint(
            "(staged_credential_ciphertext IS NULL) = (staged_credential_format IS NULL)",
            name="ck_cloud_integration_authorization_attempt_staged_pair",
        ),
        CheckConstraint(
            "btrim(credential_audience) <> ''",
            name="ck_cloud_integration_authorization_attempt_audience",
        ),
        CheckConstraint(
            "(purpose = 'connect' AND account_id IS NULL "
            "AND starting_grant_version IS NULL "
            "AND starting_credential_version IS NULL) OR "
            "(purpose IN ('reauthorize', 'rotate') AND account_id IS NOT NULL "
            "AND starting_grant_version IS NOT NULL "
            "AND starting_credential_version IS NOT NULL)",
            name="ck_cloud_int_auth_attempt_starting_connection",
        ),
        CheckConstraint(
            "(status IN ('active', 'exchanging', 'validating') AND closed_at IS NULL) OR "
            "(status IN ('succeeded', 'failed', 'cancelled', 'expired', 'superseded') "
            "AND closed_at IS NOT NULL)",
            name="ck_cloud_int_auth_attempt_terminal_time",
        ),
        UniqueConstraint(
            "owner_user_id",
            "definition_id",
            "generation",
            name="uq_cloud_integration_authorization_attempt_generation",
        ),
        Index(
            "ux_cloud_integration_authorization_attempt_nonterminal",
            "owner_user_id",
            "definition_id",
            unique=True,
            postgresql_where="status IN ('active', 'exchanging', 'validating')",
        ),
        Index("ix_cloud_integration_authorization_attempt_expires_at", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    definition_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_integration_definition.id"),
        index=True,
    )
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_integration_account.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    purpose: Mapped[str] = mapped_column(String(32))
    method: Mapped[str] = mapped_column(String(32))
    generation: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32), default="active")
    starting_grant_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    starting_credential_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    definition_security_revision_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_integration_definition_security_revision.id"),
    )
    provider_client_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_integration_oauth_client.id"),
        nullable=True,
    )
    credential_audience: Mapped[str] = mapped_column(Text)
    settings_json: Mapped[str] = mapped_column(Text, default="{}")
    requested_scopes_json: Mapped[str] = mapped_column(Text, default="[]")
    effective_scopes_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    staged_credential_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    staged_credential_format: Mapped[str | None] = mapped_column(String(64), nullable=True)
    failure_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
