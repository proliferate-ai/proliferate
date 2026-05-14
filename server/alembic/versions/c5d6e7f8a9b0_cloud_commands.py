"""cloud commands

Revision ID: c5d6e7f8a9b0
Revises: c4d5e6f7a8b9
Create Date: 2026-05-13 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c5d6e7f8a9b0"
down_revision: str | Sequence[str] | None = "c4d5e6f7a8b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def _create_index_once(
    index_name: str,
    table_name: str,
    columns: list[str],
    *,
    unique: bool = False,
) -> None:
    if not _has_index(table_name, index_name):
        op.create_index(index_name, table_name, columns, unique=unique)


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_table("cloud_commands"):
        op.create_table(
            "cloud_commands",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("idempotency_scope", sa.String(length=255), nullable=False),
            sa.Column("idempotency_key", sa.String(length=255), nullable=False),
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("organization_id", sa.Uuid(), nullable=True),
            sa.Column("actor_user_id", sa.Uuid(), nullable=True),
            sa.Column("actor_kind", sa.String(length=32), nullable=False),
            sa.Column("source", sa.String(length=32), nullable=False),
            sa.Column("workspace_id", sa.String(length=255), nullable=True),
            sa.Column("session_id", sa.String(length=255), nullable=True),
            sa.Column("kind", sa.String(length=64), nullable=False),
            sa.Column("payload_json", sa.Text(), nullable=False),
            sa.Column("observed_event_seq", sa.Integer(), nullable=True),
            sa.Column("preconditions_json", sa.Text(), nullable=True),
            sa.Column("authorization_context_json", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("lease_id", sa.String(length=64), nullable=True),
            sa.Column("leased_by_worker_id", sa.Uuid(), nullable=True),
            sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("expired_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("error_code", sa.String(length=128), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("result_json", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "kind IN ('start_session', 'resume_session', 'send_prompt', "
                "'resolve_interaction', 'update_session_config', 'cancel_turn', "
                "'cancel_session', 'stop_workspace', 'hibernate_workspace', "
                "'resume_workspace', 'prune_workspace', 'extend_workspace_ttl', "
                "'sync_existing_workspace')",
                name="ck_cloud_commands_kind",
            ),
            sa.CheckConstraint(
                "status IN ('queued', 'leased', 'delivered', 'accepted', "
                "'accepted_but_queued', 'rejected', 'expired', 'superseded', "
                "'failed_delivery')",
                name="ck_cloud_commands_status",
            ),
            sa.CheckConstraint(
                "actor_kind IN ('user', 'automation', 'slack', 'api_key', 'system')",
                name="ck_cloud_commands_actor_kind",
            ),
            sa.CheckConstraint(
                "source IN ('web', 'mobile', 'slack', 'api', 'automation', "
                "'desktop_cloud_view')",
                name="ck_cloud_commands_source",
            ),
            sa.ForeignKeyConstraint(["actor_user_id"], ["user.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["leased_by_worker_id"],
                ["cloud_workers.id"],
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_cloud_commands_target_id", "cloud_commands", ["target_id"])
    _create_index_once("ix_cloud_commands_organization_id", "cloud_commands", ["organization_id"])
    _create_index_once("ix_cloud_commands_actor_user_id", "cloud_commands", ["actor_user_id"])
    _create_index_once("ix_cloud_commands_workspace_id", "cloud_commands", ["workspace_id"])
    _create_index_once("ix_cloud_commands_session_id", "cloud_commands", ["session_id"])
    _create_index_once("ix_cloud_commands_kind", "cloud_commands", ["kind"])
    _create_index_once("ix_cloud_commands_status", "cloud_commands", ["status"])
    _create_index_once(
        "uq_cloud_commands_idempotency_scope_key",
        "cloud_commands",
        ["idempotency_scope", "idempotency_key"],
        unique=True,
    )
    _create_index_once(
        "ix_cloud_commands_target_status_created",
        "cloud_commands",
        ["target_id", "status", "created_at"],
    )
    _create_index_once(
        "ix_cloud_commands_session_status_created",
        "cloud_commands",
        ["session_id", "status", "created_at"],
    )
    _create_index_once(
        "ix_cloud_commands_lease_expires_at",
        "cloud_commands",
        ["lease_expires_at"],
    )
    _create_index_once(
        "ix_cloud_commands_leased_by_worker_id",
        "cloud_commands",
        ["leased_by_worker_id"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("cloud_commands")
