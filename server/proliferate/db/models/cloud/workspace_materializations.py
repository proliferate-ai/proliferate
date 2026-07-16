"""Durable cloud workspace materialization ledger ORM model.

A cloud workspace (a product row) can be materialized onto more than one
runnable checkout: the managed-Cloud sandbox and/or one or more local Desktop
installs. This ledger records each target-scoped materialization separately so
a local checkout path or AnyHarness id is never stored as global workspace
identity. ``unlinked_at`` is a soft delete: rows are never hard-deleted so stale
reports and operation retries can be rejected by generation.
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudWorkspaceMaterialization(Base):
    __tablename__ = "cloud_workspace_materialization"
    __table_args__ = (
        CheckConstraint(
            "target_kind IN ('managed_cloud', 'local_desktop')",
            name="ck_cloud_workspace_materialization_target_kind",
        ),
        CheckConstraint(
            "state IN ('pending', 'hydrating', 'hydrated', 'missing', 'inconsistent', 'failed')",
            name="ck_cloud_workspace_materialization_state",
        ),
        CheckConstraint(
            "generation >= 1",
            name="ck_cloud_workspace_materialization_generation",
        ),
        CheckConstraint(
            "(target_kind = 'managed_cloud' AND desktop_install_id IS NULL) OR "
            "(target_kind = 'local_desktop' AND desktop_install_id IS NOT NULL "
            "AND cloud_sandbox_id IS NULL)",
            name="ck_cloud_workspace_materialization_kind_fields",
        ),
        Index(
            "ux_cloud_workspace_materialization_active_managed",
            "cloud_workspace_id",
            unique=True,
            postgresql_where=text("target_kind = 'managed_cloud' AND unlinked_at IS NULL"),
        ),
        Index(
            "ux_cloud_workspace_materialization_active_local",
            "cloud_workspace_id",
            "desktop_install_id",
            unique=True,
            postgresql_where=text("target_kind = 'local_desktop' AND unlinked_at IS NULL"),
        ),
        Index(
            "ux_cloud_workspace_materialization_active_sandbox_runtime",
            "cloud_sandbox_id",
            "anyharness_workspace_id",
            unique=True,
            postgresql_where=text(
                "cloud_sandbox_id IS NOT NULL AND anyharness_workspace_id IS NOT NULL "
                "AND unlinked_at IS NULL"
            ),
        ),
        Index(
            "ux_cloud_workspace_materialization_active_install_runtime",
            "desktop_install_id",
            "anyharness_workspace_id",
            unique=True,
            postgresql_where=text(
                "desktop_install_id IS NOT NULL AND anyharness_workspace_id IS NOT NULL "
                "AND unlinked_at IS NULL"
            ),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    cloud_workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_workspace.id", ondelete="CASCADE"),
        index=True,
    )
    target_kind: Mapped[str] = mapped_column(String(32))
    cloud_sandbox_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_sandbox.id", ondelete="SET NULL"),
        nullable=True,
    )
    desktop_install_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    anyharness_workspace_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    worktree_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    state: Mapped[str] = mapped_column(String(32))
    generation: Mapped[int] = mapped_column(Integer, default=1)
    expected_head_sha: Mapped[str | None] = mapped_column(String(64), nullable=True)
    observed_head_sha: Mapped[str | None] = mapped_column(String(64), nullable=True)
    observed_branch: Mapped[str | None] = mapped_column(String(255), nullable=True)
    failure_code: Mapped[str | None] = mapped_column(String(255), nullable=True)
    failure_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_reported_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    unlinked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
