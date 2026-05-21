"""Cloud agent run configuration ORM models."""

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
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudAgentRunConfig(Base):
    __tablename__ = "cloud_agent_run_config"
    __table_args__ = (
        CheckConstraint(
            "owner_scope IN ('system', 'personal', 'organization')",
            name="ck_cloud_agent_run_config_owner_scope",
        ),
        CheckConstraint(
            "((owner_scope = 'system' AND owner_user_id IS NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL) "
            "OR (owner_scope = 'organization' AND organization_id IS NOT NULL "
            "AND owner_user_id IS NULL))",
            name="ck_cloud_agent_run_config_owner_fields",
        ),
        CheckConstraint(
            "agent_kind IN ('claude', 'codex', 'opencode', 'gemini', 'cursor')",
            name="ck_cloud_agent_run_config_agent_kind",
        ),
        CheckConstraint(
            "status IN ('active', 'archived')",
            name="ck_cloud_agent_run_config_status",
        ),
        CheckConstraint(
            "((owner_scope = 'system' AND seed_key IS NOT NULL) OR "
            "(owner_scope != 'system' AND seed_key IS NULL AND system_default_rank IS NULL))",
            name="ck_cloud_agent_run_config_seed_fields",
        ),
        Index("ix_cloud_agent_run_config_owner_user", "owner_user_id"),
        Index("ix_cloud_agent_run_config_organization", "organization_id"),
        Index("ix_cloud_agent_run_config_agent_kind", "agent_kind"),
        Index(
            "ux_cloud_agent_run_config_system_seed",
            "agent_kind",
            "seed_key",
            unique=True,
            postgresql_where=text("owner_scope = 'system'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_scope: Mapped[str] = mapped_column(String(32))
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        nullable=True,
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=True,
    )
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
    )

    name: Mapped[str] = mapped_column(String(255))
    agent_kind: Mapped[str] = mapped_column(String(32))
    model_id: Mapped[str] = mapped_column(String(255))
    control_values_json: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )

    usable_in_personal_sandboxes: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        server_default=text("true"),
    )
    usable_in_shared_sandboxes: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default=text("false"),
    )

    seed_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    system_default_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(
        String(32),
        default="active",
        server_default=text("'active'"),
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudAgentRunConfigDefault(Base):
    __tablename__ = "cloud_agent_run_config_default"
    __table_args__ = (
        CheckConstraint(
            "owner_scope IN ('personal', 'organization')",
            name="ck_cloud_agent_run_config_default_owner_scope",
        ),
        CheckConstraint(
            "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL) "
            "OR (owner_scope = 'organization' AND organization_id IS NOT NULL "
            "AND owner_user_id IS NULL))",
            name="ck_cloud_agent_run_config_default_owner_fields",
        ),
        CheckConstraint(
            "agent_kind IN ('claude', 'codex', 'opencode', 'gemini', 'cursor')",
            name="ck_cloud_agent_run_config_default_agent_kind",
        ),
        Index(
            "ux_cloud_agent_run_config_default_user",
            "owner_user_id",
            "agent_kind",
            unique=True,
            postgresql_where=text("owner_scope = 'personal'"),
        ),
        Index(
            "ux_cloud_agent_run_config_default_org",
            "organization_id",
            "agent_kind",
            unique=True,
            postgresql_where=text("owner_scope = 'organization'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_scope: Mapped[str] = mapped_column(String(32))
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        nullable=True,
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=True,
    )
    agent_kind: Mapped[str] = mapped_column(String(32))
    config_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_agent_run_config.id", ondelete="CASCADE"),
    )
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
