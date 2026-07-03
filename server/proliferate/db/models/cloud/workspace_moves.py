"""Workspace move ORM model.

A ``workspace_move`` row is the durable ledger entry for one round-trip
handoff of a workspace between runtimes (local desktop <-> cloud sandbox,
``ssh`` joining later). See ``specs/tbd/workspace-migration-v2.md`` section 2.2
for the locked data model. The old mobility tables
(``cloud_workspace_mobility``, ``cloud_workspace_mobility_event``,
``cloud_workspace_handoff_op``, ``cloud_workspace_move_cleanup_item``) are
barred by ``server/tests/integration/schema_migration_assertions.py`` and must
not be reused.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow

_RUNTIME_KINDS = "('local', 'cloud', 'ssh')"
_PHASES = "('started', 'destination_ready', 'installed', 'cutover', 'completed', 'failed')"
_CANONICAL_SIDES = "('source', 'destination')"


class WorkspaceMove(Base):
    __tablename__ = "workspace_move"
    __table_args__ = (
        CheckConstraint(f"source_kind IN {_RUNTIME_KINDS}", name="ck_workspace_move_source_kind"),
        CheckConstraint(
            f"destination_kind IN {_RUNTIME_KINDS}",
            name="ck_workspace_move_destination_kind",
        ),
        CheckConstraint(f"phase IN {_PHASES}", name="ck_workspace_move_phase"),
        CheckConstraint(
            f"canonical_side IN {_CANONICAL_SIDES}",
            name="ck_workspace_move_canonical_side",
        ),
        Index(
            "ux_workspace_move_active_identity",
            "user_id",
            "repo_config_id",
            "branch",
            unique=True,
            postgresql_where=text("phase NOT IN ('completed', 'failed')"),
        ),
        Index(
            "ux_workspace_move_user_idempotency_key",
            "user_id",
            "idempotency_key",
            unique=True,
        ),
        Index("ix_workspace_move_repo_config_id", "repo_config_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    repo_config_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("repo_config.id", ondelete="CASCADE"),
    )
    branch: Mapped[str] = mapped_column(String(255))

    source_kind: Mapped[str] = mapped_column(String(16))
    destination_kind: Mapped[str] = mapped_column(String(16))
    source_ref: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    destination_ref: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )

    base_commit_sha: Mapped[str] = mapped_column(String(64))

    phase: Mapped[str] = mapped_column(
        String(32),
        default="started",
        server_default=text("'started'"),
    )
    canonical_side: Mapped[str] = mapped_column(
        String(16),
        default="source",
        server_default=text("'source'"),
    )

    failure_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    failure_detail: Mapped[str | None] = mapped_column(Text, nullable=True)

    idempotency_key: Mapped[str] = mapped_column(String(255))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    cutover_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
