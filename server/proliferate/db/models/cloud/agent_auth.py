"""Agent LLM auth gateway ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.constants.cloud import (
    SUPPORTED_AGENT_AUTH_CREDENTIAL_KINDS,
    SUPPORTED_AGENT_AUTH_CREDENTIAL_SHARE_STATUSES,
    SUPPORTED_AGENT_AUTH_CREDENTIAL_STATUSES,
    SUPPORTED_AGENT_AUTH_OWNER_SCOPES,
    SUPPORTED_AGENT_GATEWAY_BUDGET_SUBJECT_STATUSES,
    SUPPORTED_AGENT_GATEWAY_POLICY_KINDS,
    SUPPORTED_AGENT_GATEWAY_POLICY_STATUSES,
    SUPPORTED_AGENT_GATEWAY_PROTOCOL_FACADES,
    SUPPORTED_AGENT_GATEWAY_PROVIDER_KINDS,
    SUPPORTED_AGENT_GATEWAY_PROVIDER_VALIDATION_STATUSES,
    SUPPORTED_AGENT_GATEWAY_SYNC_STATUSES,
    SUPPORTED_CLOUD_AGENTS,
    SUPPORTED_SANDBOX_AGENT_AUTH_MATERIALIZATION_MODES,
    SUPPORTED_SANDBOX_AGENT_AUTH_SELECTION_STATUSES,
    SUPPORTED_SANDBOX_AGENT_AUTH_TARGET_STATE_STATUSES,
    SUPPORTED_SANDBOX_PROFILE_OWNER_SCOPES,
    SUPPORTED_SANDBOX_PROFILE_STATUSES,
    SUPPORTED_SANDBOX_PROFILE_TARGET_STATE_STATUSES,
)
from proliferate.db.models.base import Base, utcnow


class SandboxProfile(Base):
    __tablename__ = "sandbox_profile"
    __table_args__ = (
        CheckConstraint(
            f"owner_scope IN {SUPPORTED_SANDBOX_PROFILE_OWNER_SCOPES}",
            name="ck_sandbox_profile_owner_scope",
        ),
        CheckConstraint(
            "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'organization' AND owner_user_id IS NULL "
            "AND organization_id IS NOT NULL))",
            name="ck_sandbox_profile_owner_fields",
        ),
        CheckConstraint(
            f"status IN {SUPPORTED_SANDBOX_PROFILE_STATUSES}",
            name="ck_sandbox_profile_status",
        ),
        Index(
            "uq_sandbox_profile_active_personal_user",
            "owner_user_id",
            unique=True,
            postgresql_where=text(
                "owner_scope = 'personal' AND archived_at IS NULL"
            ),
        ),
        Index(
            "uq_sandbox_profile_active_organization",
            "organization_id",
            unique=True,
            postgresql_where=text(
                "owner_scope = 'organization' AND archived_at IS NULL"
            ),
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
    billing_subject_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("billing_subject.id", ondelete="RESTRICT"),
        index=True,
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    desired_agent_auth_revision: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="configuring", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SandboxProfileAgentAuthRevision(Base):
    __tablename__ = "sandbox_profile_agent_auth_revision"
    __table_args__ = (
        Index(
            "uq_sandbox_profile_agent_auth_revision_profile_revision",
            "sandbox_profile_id",
            "revision",
            unique=True,
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sandbox_profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sandbox_profile.id", ondelete="CASCADE"),
        index=True,
    )
    revision: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(128))
    force_restart: Mapped[bool] = mapped_column(default=False)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


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
            f"agent_kind IN {SUPPORTED_CLOUD_AGENTS}",
            name="ck_agent_auth_credential_agent_kind",
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
            "ix_agent_auth_credential_owner_user_kind_status",
            "owner_scope",
            "owner_user_id",
            "agent_kind",
            "status",
        ),
        Index(
            "ix_agent_auth_credential_org_kind_status",
            "owner_scope",
            "organization_id",
            "agent_kind",
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
    agent_kind: Mapped[str] = mapped_column(String(32), index=True)
    credential_kind: Mapped[str] = mapped_column(String(32), index=True)
    display_name: Mapped[str] = mapped_column(String(255))
    redacted_summary_json: Mapped[str] = mapped_column(Text, default="{}")
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    legacy_cloud_credential_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_credential.id", ondelete="SET NULL"),
        unique=True,
        nullable=True,
    )
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
            f"allowed_agent_kind IN {SUPPORTED_CLOUD_AGENTS}",
            name="ck_agent_auth_credential_share_agent_kind",
        ),
        Index(
            "uq_agent_auth_active_share_credential_org",
            "credential_id",
            "organization_id",
            unique=True,
            postgresql_where=text("status = 'active'"),
        ),
        Index(
            "ix_agent_auth_share_org_kind_status",
            "organization_id",
            "allowed_agent_kind",
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
    allowed_agent_kind: Mapped[str] = mapped_column(String(32), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )


class AgentGatewayBudgetSubject(Base):
    __tablename__ = "agent_gateway_budget_subject"
    __table_args__ = (
        CheckConstraint(
            "budget_kind = 'proliferate_managed'",
            name="ck_agent_gateway_budget_subject_kind",
        ),
        CheckConstraint(
            "owner_scope = 'organization'",
            name="ck_agent_gateway_budget_subject_owner_scope",
        ),
        CheckConstraint(
            "organization_id IS NOT NULL",
            name="ck_agent_gateway_budget_subject_org",
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
            postgresql_where=text("budget_kind = 'proliferate_managed' AND status != 'revoked'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    budget_kind: Mapped[str] = mapped_column(String(32), default="proliferate_managed")
    owner_scope: Mapped[str] = mapped_column(String(32), default="organization")
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        index=True,
    )
    litellm_team_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    included_budget_usd: Mapped[str] = mapped_column(String(64))
    budget_duration: Mapped[str] = mapped_column(String(32), default="30d")
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
            "uq_sandbox_agent_auth_selection_profile_agent",
            "sandbox_profile_id",
            "agent_kind",
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


class SandboxProfileTargetState(Base):
    __tablename__ = "sandbox_profile_target_state"
    __table_args__ = (
        CheckConstraint(
            f"agent_auth_status IN {SUPPORTED_SANDBOX_AGENT_AUTH_TARGET_STATE_STATUSES}",
            name="ck_sandbox_profile_target_state_agent_auth_status",
        ),
        CheckConstraint(
            f"runtime_config_status IN {SUPPORTED_SANDBOX_PROFILE_TARGET_STATE_STATUSES}",
            name="ck_sandbox_profile_target_state_runtime_config_status",
        ),
        CheckConstraint(
            "applied_agent_auth_revision IS NULL "
            "OR applied_agent_auth_revision <= desired_agent_auth_revision",
            name="ck_sandbox_profile_target_state_agent_auth_applied_lte_desired",
        ),
        CheckConstraint(
            "(active_sandbox_id IS NULL AND slot_generation IS NULL) OR "
            "(active_sandbox_id IS NOT NULL AND slot_generation IS NOT NULL)",
            name="ck_sandbox_profile_target_state_slot_identity",
        ),
        Index(
            "uq_sandbox_profile_target_state_target_profile",
            "target_id",
            "sandbox_profile_id",
            unique=True,
        ),
        Index(
            "ix_sandbox_profile_target_state_agent_auth_status_revision",
            "target_id",
            "agent_auth_status",
            "desired_agent_auth_revision",
            "applied_agent_auth_revision",
        ),
        Index(
            "ix_sandbox_profile_target_state_runtime_config_status",
            "target_id",
            "runtime_config_status",
            "applied_runtime_config_sequence",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sandbox_profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sandbox_profile.id", ondelete="CASCADE"),
        index=True,
    )
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    active_sandbox_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_sandbox.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    slot_generation: Mapped[int | None] = mapped_column(Integer, nullable=True)
    desired_agent_auth_revision: Mapped[int] = mapped_column(Integer, default=0)
    applied_agent_auth_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    agent_auth_status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    agent_auth_force_restart_required: Mapped[bool] = mapped_column(default=False)
    last_agent_auth_command_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_commands.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    last_agent_auth_worker_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workers.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    last_agent_auth_attempted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_agent_auth_applied_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_agent_auth_error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_agent_auth_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    applied_runtime_config_sequence: Mapped[int] = mapped_column(Integer, default=0)
    applied_runtime_config_revision_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    runtime_config_status: Mapped[str] = mapped_column(String(32), default="applied")
    last_runtime_config_command_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_commands.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    last_runtime_config_worker_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workers.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    last_runtime_config_attempted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_runtime_config_applied_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_runtime_config_error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_runtime_config_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
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
    protocol_facade: Mapped[str] = mapped_column(String(32))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AgentAuthAuditEvent(Base):
    __tablename__ = "agent_auth_audit_event"
    __table_args__ = (
        Index("ix_agent_auth_audit_event_actor_created", "actor_user_id", "created_at"),
        Index("ix_agent_auth_audit_event_org_created", "organization_id", "created_at"),
        Index("ix_agent_auth_audit_event_credential_created", "credential_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    action: Mapped[str] = mapped_column(String(64), index=True)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    owner_scope: Mapped[str] = mapped_column(String(32), index=True)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    credential_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_auth_credential.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    sandbox_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sandbox_profile.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    target_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
