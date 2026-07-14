"""Workflow definition persistence models."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class WorkflowDefinition(Base):
    __tablename__ = "workflow_definition"
    __table_args__ = (
        CheckConstraint(
            "schema_version = 1",
            name="ck_workflow_definition_schema_version",
        ),
        CheckConstraint(
            "revision >= 1",
            name="ck_workflow_definition_revision",
        ),
        Index(
            "ix_workflow_definition_user_updated",
            "user_id",
            "updated_at",
            "id",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "ix_workflow_definition_default_repo_config_id",
            "default_repo_config_id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
    )
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(
        Text,
        default="",
        server_default=text("''"),
    )
    schema_version: Mapped[int] = mapped_column(
        Integer,
        default=1,
        server_default=text("1"),
    )
    revision: Mapped[int] = mapped_column(
        Integer,
        default=1,
        server_default=text("1"),
    )
    validated_catalog_version: Mapped[str] = mapped_column(String(128))
    default_repo_config_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("repo_config.id", ondelete="SET NULL"),
        nullable=True,
    )
    inputs_json: Mapped[list[dict[str, object]]] = mapped_column(
        JSONB,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    stages_json: Mapped[list[dict[str, object]]] = mapped_column(
        JSONB,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WorkflowInvocation(Base):
    __tablename__ = "workflow_invocation"
    __table_args__ = (
        CheckConstraint(
            "schema_version = 1",
            name="ck_workflow_invocation_schema_version",
        ),
        Index("ix_workflow_invocation_user_created", "user_id", "created_at", "id"),
        Index("ix_workflow_invocation_definition", "workflow_definition_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
    )
    workflow_definition_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    definition_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    title_snapshot: Mapped[str] = mapped_column(String(255), nullable=False)
    description_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    schema_version: Mapped[int] = mapped_column(
        Integer,
        default=1,
        server_default=text("1"),
    )
    creation_request_json: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    invocation_json: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        server_default=text("now()"),
        onupdate=utcnow,
    )
