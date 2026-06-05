"""Agent-auth ORM router models."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.constants.cloud import (
    SUPPORTED_AGENT_GATEWAY_ROUTER_MATERIALIZATION_STATUSES,
    SUPPORTED_AGENT_GATEWAY_ROUTER_OBJECT_KINDS,
    SUPPORTED_AGENT_GATEWAY_ROUTER_OBJECT_SCOPES,
    SUPPORTED_AGENT_GATEWAY_SYNC_STATUSES,
)
from proliferate.db.models.base import Base, utcnow


class AgentGatewayRouterMaterialization(Base):
    __tablename__ = "agent_gateway_router_materialization"
    __table_args__ = (
        CheckConstraint(
            "router_kind = 'bifrost'",
            name="ck_agent_gateway_router_materialization_router_kind",
        ),
        CheckConstraint(
            f"router_object_kind IN {SUPPORTED_AGENT_GATEWAY_ROUTER_OBJECT_KINDS}",
            name="ck_agent_gateway_router_materialization_object_kind",
        ),
        CheckConstraint(
            f"object_scope IN {SUPPORTED_AGENT_GATEWAY_ROUTER_OBJECT_SCOPES}",
            name="ck_agent_gateway_router_materialization_object_scope",
        ),
        CheckConstraint(
            f"sync_status IN {SUPPORTED_AGENT_GATEWAY_SYNC_STATUSES}",
            name="ck_agent_gateway_router_materialization_sync_status",
        ),
        CheckConstraint(
            f"status IN {SUPPORTED_AGENT_GATEWAY_ROUTER_MATERIALIZATION_STATUSES}",
            name="ck_agent_gateway_router_materialization_status",
        ),
        Index(
            "uq_agent_gateway_router_materialization_runtime",
            "router_kind",
            "router_object_kind",
            "object_scope",
            "selection_id",
            "target_id",
            unique=True,
            postgresql_where=text("object_scope = 'runtime_selection' AND status != 'revoked'"),
        ),
        Index(
            "uq_agent_gateway_router_materialization_policy_object",
            "router_kind",
            "router_object_kind",
            "object_scope",
            "policy_id",
            unique=True,
            postgresql_where=text("object_scope = 'policy' AND status != 'revoked'"),
        ),
        Index(
            "uq_agent_gateway_router_materialization_budget_object",
            "router_kind",
            "router_object_kind",
            "object_scope",
            "budget_subject_id",
            "router_object_id",
            unique=True,
            postgresql_where=text("object_scope = 'budget_subject' AND status != 'revoked'"),
        ),
        Index(
            "ix_agent_gateway_router_materialization_object_id",
            "router_kind",
            "router_object_id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    router_kind: Mapped[str] = mapped_column(String(32), index=True)
    router_object_kind: Mapped[str] = mapped_column(String(32), index=True)
    object_scope: Mapped[str] = mapped_column(String(32), index=True)
    policy_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_gateway_policy.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    provider_credential_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_gateway_provider_credential.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    budget_subject_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_gateway_budget_subject.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    selection_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sandbox_agent_auth_selection.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    sandbox_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sandbox_profile.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    target_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    agent_kind: Mapped[str | None] = mapped_column(String(32), index=True, nullable=True)
    protocol_facade: Mapped[str | None] = mapped_column(String(32), nullable=True)
    router_object_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    router_object_secret_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    router_object_secret_ciphertext_key_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )
    sync_status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    sync_fingerprint: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    last_reconciled_at: Mapped[datetime | None] = mapped_column(
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


class AgentGatewayLlmUsageEvent(Base):
    __tablename__ = "agent_gateway_llm_usage_event"
    __table_args__ = (
        Index(
            "uq_agent_gateway_llm_usage_event_router_log",
            "router_kind",
            "router_log_id",
            unique=True,
        ),
        Index(
            "ix_agent_gateway_llm_usage_event_budget_subject",
            "budget_subject_id",
            "occurred_at",
        ),
        Index(
            "ix_agent_gateway_llm_usage_event_router_virtual_key",
            "router_kind",
            "router_virtual_key_id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    router_kind: Mapped[str] = mapped_column(String(32), index=True)
    router_log_id: Mapped[str] = mapped_column(String(255))
    router_virtual_key_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    router_provider_key_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    materialization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_gateway_router_materialization.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    policy_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_gateway_policy.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    budget_subject_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_gateway_budget_subject.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    owner_scope: Mapped[str | None] = mapped_column(String(32), nullable=True)
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
    agent_kind: Mapped[str | None] = mapped_column(String(32), index=True, nullable=True)
    protocol_facade: Mapped[str | None] = mapped_column(String(32), nullable=True)
    provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    cost_usd: Mapped[str] = mapped_column(String(64), default="0")
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    raw_usage_json: Mapped[str] = mapped_column(Text, default="{}")


class AgentGatewayUsageImportCursor(Base):
    __tablename__ = "agent_gateway_usage_import_cursor"
    __table_args__ = (
        Index("uq_agent_gateway_usage_import_cursor_router", "router_kind", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    router_kind: Mapped[str] = mapped_column(String(32), index=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_router_log_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


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
