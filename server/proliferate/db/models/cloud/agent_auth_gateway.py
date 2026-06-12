"""Agent-auth ORM gateway models."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.constants.cloud import (
    SUPPORTED_AGENT_AUTH_OWNER_SCOPES,
    SUPPORTED_AGENT_GATEWAY_BUDGET_SUBJECT_STATUSES,
    SUPPORTED_AGENT_GATEWAY_FREE_CREDIT_ENTITLEMENT_STATUSES,
    SUPPORTED_AGENT_GATEWAY_POLICY_KINDS,
    SUPPORTED_AGENT_GATEWAY_POLICY_STATUSES,
    SUPPORTED_AGENT_GATEWAY_PROTOCOL_FACADES,
    SUPPORTED_AGENT_GATEWAY_PROVIDER_KINDS,
    SUPPORTED_AGENT_GATEWAY_PROVIDER_VALIDATION_STATUSES,
    SUPPORTED_AGENT_GATEWAY_SYNC_STATUSES,
    SUPPORTED_CLOUD_AGENTS,
)
from proliferate.db.models.base import Base, utcnow


class AgentGatewayBudgetSubject(Base):
    __tablename__ = "agent_gateway_budget_subject"
    __table_args__ = (
        CheckConstraint(
            "budget_kind = 'proliferate_managed'",
            name="ck_agent_gateway_budget_subject_kind",
        ),
        CheckConstraint(
            "owner_scope IN ('personal', 'organization')",
            name="ck_agent_gateway_budget_subject_owner_scope",
        ),
        CheckConstraint(
            "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'organization' AND owner_user_id IS NULL "
            "AND organization_id IS NOT NULL))",
            name="ck_agent_gateway_budget_subject_owner_fields",
        ),
        CheckConstraint(
            f"litellm_sync_status IN {SUPPORTED_AGENT_GATEWAY_SYNC_STATUSES}",
            name="ck_agent_gateway_budget_subject_sync_status",
        ),
        CheckConstraint(
            f"status IN {SUPPORTED_AGENT_GATEWAY_BUDGET_SUBJECT_STATUSES}",
            name="ck_agent_gateway_budget_subject_status",
        ),
        Index(
            "uq_agent_gateway_managed_budget_subject_org",
            "organization_id",
            unique=True,
            postgresql_where=text(
                "owner_scope = 'organization' "
                "AND budget_kind = 'proliferate_managed' "
                "AND status != 'revoked'"
            ),
        ),
        Index(
            "uq_agent_gateway_managed_budget_subject_user",
            "owner_user_id",
            unique=True,
            postgresql_where=text(
                "owner_scope = 'personal' "
                "AND budget_kind = 'proliferate_managed' "
                "AND status != 'revoked'"
            ),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    budget_kind: Mapped[str] = mapped_column(String(32), default="proliferate_managed")
    owner_scope: Mapped[str] = mapped_column(String(32), default="organization", index=True)
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
    litellm_team_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    included_budget_usd: Mapped[str] = mapped_column(String(64))
    budget_duration: Mapped[str | None] = mapped_column(String(32), nullable=True)
    entitlement_source: Mapped[str | None] = mapped_column(String(64), nullable=True)
    entitlement_period_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    litellm_sync_status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    litellm_sync_fingerprint: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="invalid", index=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    last_provisioned_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_litellm_reconciled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class AgentGatewayFreeCreditEntitlement(Base):
    __tablename__ = "agent_gateway_free_credit_entitlement"
    __table_args__ = (
        CheckConstraint(
            f"status IN {SUPPORTED_AGENT_GATEWAY_FREE_CREDIT_ENTITLEMENT_STATUSES}",
            name="ck_agent_gateway_free_credit_entitlement_status",
        ),
        Index(
            "uq_agent_gateway_free_credit_entitlement_user_period_source",
            "user_id",
            "period_key",
            "source",
            unique=True,
        ),
        Index(
            "ix_agent_gateway_free_credit_entitlement_budget_subject",
            "budget_subject_id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    budget_subject_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_gateway_budget_subject.id", ondelete="SET NULL"),
        nullable=True,
    )
    source: Mapped[str] = mapped_column(String(64), default="signup_free_credit")
    period_key: Mapped[str] = mapped_column(String(64), default="registration")
    included_budget_usd: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default="provisioning", index=True)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    exhausted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class AgentGatewayPolicy(Base):
    __tablename__ = "agent_gateway_policy"
    __table_args__ = (
        CheckConstraint(
            f"policy_kind IN {SUPPORTED_AGENT_GATEWAY_POLICY_KINDS}",
            name="ck_agent_gateway_policy_kind",
        ),
        CheckConstraint(
            f"owner_scope IN {SUPPORTED_AGENT_AUTH_OWNER_SCOPES}",
            name="ck_agent_gateway_policy_owner_scope",
        ),
        CheckConstraint(
            "((owner_scope = 'system' AND owner_user_id IS NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'organization' AND owner_user_id IS NULL "
            "AND organization_id IS NOT NULL))",
            name="ck_agent_gateway_policy_owner_fields",
        ),
        CheckConstraint(
            "((policy_kind = 'proliferate_managed' AND budget_subject_id IS NOT NULL) OR "
            "(policy_kind != 'proliferate_managed' AND budget_subject_id IS NULL))",
            name="ck_agent_gateway_policy_budget_subject",
        ),
        CheckConstraint(
            f"litellm_sync_status IN {SUPPORTED_AGENT_GATEWAY_SYNC_STATUSES}",
            name="ck_agent_gateway_policy_sync_status",
        ),
        CheckConstraint(
            f"status IN {SUPPORTED_AGENT_GATEWAY_POLICY_STATUSES}",
            name="ck_agent_gateway_policy_status",
        ),
        Index("uq_agent_gateway_policy_credential", "credential_id", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    credential_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent_auth_credential.id", ondelete="CASCADE"),
        index=True,
    )
    policy_kind: Mapped[str] = mapped_column(String(32), index=True)
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
    budget_subject_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_gateway_budget_subject.id", ondelete="RESTRICT"),
        index=True,
        nullable=True,
    )
    litellm_team_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    litellm_virtual_key_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    litellm_virtual_key_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    litellm_virtual_key_ciphertext_key_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )
    litellm_sync_status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    litellm_sync_fingerprint: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="provisioning", index=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    last_provisioned_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_litellm_reconciled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class AgentGatewayProviderCredential(Base):
    __tablename__ = "agent_gateway_provider_credential"
    __table_args__ = (
        CheckConstraint(
            f"provider_kind IN {SUPPORTED_AGENT_GATEWAY_PROVIDER_KINDS}",
            name="ck_agent_gateway_provider_credential_kind",
        ),
        CheckConstraint(
            f"validation_status IN {SUPPORTED_AGENT_GATEWAY_PROVIDER_VALIDATION_STATUSES}",
            name="ck_agent_gateway_provider_credential_validation_status",
        ),
        Index("uq_agent_gateway_provider_credential_policy", "policy_id", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    policy_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent_gateway_policy.id", ondelete="CASCADE"),
        index=True,
    )
    provider_kind: Mapped[str] = mapped_column(String(64), index=True)
    payload_ciphertext: Mapped[str] = mapped_column(Text)
    payload_ciphertext_key_id: Mapped[str] = mapped_column(String(64))
    redacted_summary_json: Mapped[str] = mapped_column(Text, default="{}")
    validation_status: Mapped[str] = mapped_column(String(32), default="unvalidated", index=True)
    validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    validation_error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    validation_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class AgentGatewayRuntimeGrant(Base):
    __tablename__ = "agent_gateway_runtime_grant"
    __table_args__ = (
        CheckConstraint(
            f"agent_kind IN {SUPPORTED_CLOUD_AGENTS}",
            name="ck_agent_gateway_runtime_grant_agent_kind",
        ),
        CheckConstraint(
            f"protocol_facade IN {SUPPORTED_AGENT_GATEWAY_PROTOCOL_FACADES}",
            name="ck_agent_gateway_runtime_grant_protocol_facade",
        ),
        Index("uq_agent_gateway_runtime_grant_token_hash", "token_hash", unique=True),
        Index(
            "ix_agent_gateway_runtime_grant_policy_revocation_expiry",
            "policy_id",
            "revoked_at",
            "expires_at",
        ),
        Index(
            "ix_agent_gateway_runtime_grant_target_profile_agent",
            "target_id",
            "sandbox_profile_id",
            "agent_kind",
            "auth_slot_id",
        ),
        Index(
            "ix_agent_gateway_runtime_grant_selection_revision",
            "selection_id",
            "issued_profile_revision",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[str] = mapped_column(String(64))
    hash_key_id: Mapped[str] = mapped_column(String(64))
    policy_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent_gateway_policy.id", ondelete="CASCADE"),
        index=True,
    )
    credential_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent_auth_credential.id", ondelete="CASCADE"),
        index=True,
    )
    selection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sandbox_agent_auth_selection.id", ondelete="CASCADE"),
        index=True,
    )
    issued_profile_revision: Mapped[int] = mapped_column(Integer)
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    sandbox_profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sandbox_profile.id", ondelete="CASCADE"),
        index=True,
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    agent_kind: Mapped[str] = mapped_column(String(32), index=True)
    auth_slot_id: Mapped[str] = mapped_column(String(64), index=True)
    protocol_facade: Mapped[str] = mapped_column(String(32))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
