"""Agent-auth ORM credentials models."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.constants.cloud import (
    SUPPORTED_AGENT_AUTH_CREDENTIAL_KINDS,
    SUPPORTED_AGENT_AUTH_CREDENTIAL_SHARE_STATUSES,
    SUPPORTED_AGENT_AUTH_CREDENTIAL_STATUSES,
    SUPPORTED_AGENT_AUTH_OWNER_SCOPES,
    SUPPORTED_AGENT_CREDENTIAL_PROVIDERS,
    SUPPORTED_CLOUD_AGENTS,
    SUPPORTED_SANDBOX_AGENT_AUTH_MATERIALIZATION_MODES,
    SUPPORTED_SANDBOX_AGENT_AUTH_SELECTION_STATUSES,
    SUPPORTED_SANDBOX_PROFILE_OWNER_SCOPES,
)
from proliferate.db.models.base import Base, utcnow


class AgentAuthCredential(Base):
    __tablename__ = "agent_auth_credential"
    __table_args__ = (
        CheckConstraint(
            f"owner_scope IN {SUPPORTED_AGENT_AUTH_OWNER_SCOPES}",
            name="ck_agent_auth_credential_owner_scope",
        ),
        CheckConstraint(
            "((owner_scope = 'system' AND owner_user_id IS NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'organization' AND owner_user_id IS NULL "
            "AND organization_id IS NOT NULL))",
            name="ck_agent_auth_credential_owner_fields",
        ),
        CheckConstraint(
            f"credential_provider_id IN {SUPPORTED_AGENT_CREDENTIAL_PROVIDERS}",
            name="ck_agent_auth_credential_provider",
        ),
        CheckConstraint(
            f"credential_kind IN {SUPPORTED_AGENT_AUTH_CREDENTIAL_KINDS}",
            name="ck_agent_auth_credential_kind",
        ),
        CheckConstraint(
            f"status IN {SUPPORTED_AGENT_AUTH_CREDENTIAL_STATUSES}",
            name="ck_agent_auth_credential_status",
        ),
        Index(
            "ix_agent_auth_credential_owner_user_provider_status",
            "owner_scope",
            "owner_user_id",
            "credential_provider_id",
            "status",
        ),
        Index(
            "ix_agent_auth_credential_org_provider_status",
            "owner_scope",
            "organization_id",
            "credential_provider_id",
            "status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_scope: Mapped[str] = mapped_column(String(32), index=True)
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
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    credential_provider_id: Mapped[str] = mapped_column(String(64), index=True)
    credential_kind: Mapped[str] = mapped_column(String(32), index=True)
    display_name: Mapped[str] = mapped_column(String(255))
    redacted_summary_json: Mapped[str] = mapped_column(Text, default="{}")
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    payload_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_ciphertext_key_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AgentAuthCredentialShare(Base):
    __tablename__ = "agent_auth_credential_share"
    __table_args__ = (
        CheckConstraint(
            "share_scope = 'organization'",
            name="ck_agent_auth_credential_share_scope",
        ),
        CheckConstraint(
            f"status IN {SUPPORTED_AGENT_AUTH_CREDENTIAL_SHARE_STATUSES}",
            name="ck_agent_auth_credential_share_status",
        ),
        CheckConstraint(
            f"allowed_credential_provider_id IN {SUPPORTED_AGENT_CREDENTIAL_PROVIDERS}",
            name="ck_agent_auth_credential_share_provider",
        ),
        Index(
            "uq_agent_auth_active_share_credential_org",
            "credential_id",
            "organization_id",
            unique=True,
            postgresql_where=text("status = 'active'"),
        ),
        Index(
            "ix_agent_auth_share_org_provider_status",
            "organization_id",
            "allowed_credential_provider_id",
            "status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    credential_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent_auth_credential.id", ondelete="CASCADE"),
        index=True,
    )
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        index=True,
    )
    share_scope: Mapped[str] = mapped_column(String(32), default="organization")
    shared_by_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    allowed_credential_provider_id: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )


class SandboxAgentAuthSelection(Base):
    __tablename__ = "sandbox_agent_auth_selection"
    __table_args__ = (
        CheckConstraint(
            f"owner_scope IN {SUPPORTED_SANDBOX_PROFILE_OWNER_SCOPES}",
            name="ck_sandbox_agent_auth_selection_owner_scope",
        ),
        CheckConstraint(
            f"agent_kind IN {SUPPORTED_CLOUD_AGENTS}",
            name="ck_sandbox_agent_auth_selection_agent_kind",
        ),
        CheckConstraint(
            f"materialization_mode IN {SUPPORTED_SANDBOX_AGENT_AUTH_MATERIALIZATION_MODES}",
            name="ck_sandbox_agent_auth_selection_materialization_mode",
        ),
        CheckConstraint(
            f"status IN {SUPPORTED_SANDBOX_AGENT_AUTH_SELECTION_STATUSES}",
            name="ck_sandbox_agent_auth_selection_status",
        ),
        CheckConstraint(
            "selected_revision > 0",
            name="ck_sandbox_agent_auth_selection_revision_positive",
        ),
        Index(
            "uq_sandbox_agent_auth_selection_profile_agent_slot",
            "sandbox_profile_id",
            "agent_kind",
            "auth_slot_id",
            unique=True,
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sandbox_profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sandbox_profile.id", ondelete="CASCADE"),
        index=True,
    )
    owner_scope: Mapped[str] = mapped_column(String(32), index=True)
    agent_kind: Mapped[str] = mapped_column(String(32), index=True)
    auth_slot_id: Mapped[str] = mapped_column(String(64), index=True)
    credential_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent_auth_credential.id", ondelete="CASCADE"),
        index=True,
    )
    credential_share_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_auth_credential_share.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    materialization_mode: Mapped[str] = mapped_column(String(32))
    selected_revision: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    last_error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
