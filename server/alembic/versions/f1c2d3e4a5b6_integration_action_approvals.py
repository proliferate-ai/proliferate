"""add durable integration action approvals

Revision ID: f1c2d3e4a5b6
Revises: e94a7c1d6b20
Create Date: 2026-07-17 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f1c2d3e4a5b6"
down_revision: str | Sequence[str] | None = "e94a7c1d6b20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "cloud_integration_action_approval",
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("integration_account_id", sa.Uuid(), nullable=False),
        sa.Column("integration_account_auth_version", sa.Integer(), nullable=False),
        sa.Column("runtime_worker_id", sa.Uuid(), nullable=False),
        sa.Column("gateway_session_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.String(length=255), nullable=False),
        sa.Column("anyharness_session_id", sa.String(length=255), nullable=False),
        sa.Column("provider_namespace", sa.String(length=64), nullable=False),
        sa.Column("tool_name", sa.String(length=255), nullable=False),
        sa.Column("payload_digest", sa.String(length=64), nullable=False),
        sa.Column("binding_digest", sa.String(length=64), nullable=False),
        sa.Column("idempotency_key", sa.String(length=64), nullable=False),
        sa.Column("safe_action_summary", sa.String(length=512), nullable=False),
        sa.Column("safe_account_label", sa.String(length=255), nullable=False),
        sa.Column("safe_source_label", sa.String(length=255), nullable=False),
        sa.Column("safe_target", sa.String(length=255), nullable=True),
        sa.Column("safe_content_preview", sa.String(length=512), nullable=True),
        sa.Column("safe_content_character_count", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'consumed', 'expired', 'revoked')",
            name="ck_cloud_integration_action_approval_status",
        ),
    )
    op.create_index(
        "ux_cloud_integration_action_approval_active_key",
        "cloud_integration_action_approval",
        ["idempotency_key"],
        unique=True,
        postgresql_where=sa.text("status IN ('pending', 'approved')"),
    )
    op.create_index(
        "ix_cloud_integration_action_approval_owner_status_created",
        "cloud_integration_action_approval",
        ["owner_user_id", "status", "created_at"],
    )
    op.create_index(
        "ix_cloud_integration_action_approval_expires_at",
        "cloud_integration_action_approval",
        ["expires_at"],
    )

    op.create_table(
        "cloud_integration_action_approval_event",
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("approval_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("from_status", sa.String(length=32), nullable=True),
        sa.Column("to_status", sa.String(length=32), nullable=False),
        sa.Column("actor_type", sa.String(length=32), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("actor_runtime_worker_id", sa.Uuid(), nullable=True),
        sa.Column("safe_action_summary", sa.String(length=512), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "event_type IN "
            "('requested', 'approved', 'rejected', 'revoked', 'expired', 'consumed')",
            name="ck_cloud_integration_action_approval_event_type",
        ),
        sa.CheckConstraint(
            "actor_type IN ('user', 'runtime_worker', 'system')",
            name="ck_cloud_integration_action_approval_event_actor_type",
        ),
        sa.CheckConstraint(
            "(actor_type = 'user' AND actor_user_id IS NOT NULL "
            "AND actor_runtime_worker_id IS NULL) OR "
            "(actor_type = 'runtime_worker' AND actor_user_id IS NULL "
            "AND actor_runtime_worker_id IS NOT NULL) OR "
            "(actor_type = 'system' AND actor_user_id IS NULL "
            "AND actor_runtime_worker_id IS NULL)",
            name="ck_cloud_integration_action_approval_event_actor_shape",
        ),
        sa.ForeignKeyConstraint(["approval_id"], ["cloud_integration_action_approval.id"]),
    )
    op.create_index(
        "ix_cloud_integration_action_approval_event_approval_created",
        "cloud_integration_action_approval_event",
        ["approval_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_table("cloud_integration_action_approval_event")
    op.drop_table("cloud_integration_action_approval")
