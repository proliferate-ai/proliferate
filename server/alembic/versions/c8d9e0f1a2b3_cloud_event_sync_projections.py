"""cloud event sync projections

Revision ID: c8d9e0f1a2b3
Revises: c7d8e9f0a1b2
Create Date: 2026-05-13 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c8d9e0f1a2b3"
down_revision: str | Sequence[str] | None = "c7d8e9f0a1b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
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


def _drop_index_once(index_name: str, table_name: str) -> None:
    if _has_index(table_name, index_name):
        op.drop_index(index_name, table_name=table_name)


def _drop_table_once(table_name: str) -> None:
    if _has_table(table_name):
        op.drop_table(table_name)


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_table("cloud_session_events"):
        op.create_table(
            "cloud_session_events",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("worker_id", sa.Uuid(), nullable=True),
            sa.Column("cloud_workspace_id", sa.Uuid(), nullable=True),
            sa.Column("workspace_id", sa.String(length=255), nullable=True),
            sa.Column("session_id", sa.String(length=255), nullable=False),
            sa.Column("anyharness_seq", sa.Integer(), nullable=False),
            sa.Column("event_type", sa.String(length=128), nullable=False),
            sa.Column("schema_version", sa.Integer(), server_default=sa.text("1"), nullable=False),
            sa.Column("source_kind", sa.String(length=32), nullable=False),
            sa.Column("turn_id", sa.String(length=255), nullable=True),
            sa.Column("item_id", sa.String(length=255), nullable=True),
            sa.Column("occurred_at", sa.String(length=64), nullable=True),
            sa.Column("payload_json", sa.Text(), nullable=True),
            sa.Column("payload_hash", sa.String(length=64), nullable=False),
            sa.Column("payload_ref", sa.Text(), nullable=True),
            sa.Column(
                "payload_size_bytes", sa.Integer(), server_default=sa.text("0"), nullable=False
            ),
            sa.Column("payload_truncated_at_bytes", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["cloud_workspace_id"], ["cloud_workspace.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["worker_id"], ["cloud_workers.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "target_id",
                "session_id",
                "anyharness_seq",
                name="uq_cloud_session_events_target_session_seq",
            ),
        )
    _create_index_once(
        "ix_cloud_session_events_cloud_workspace",
        "cloud_session_events",
        ["cloud_workspace_id"],
    )
    _create_index_once("ix_cloud_session_events_type", "cloud_session_events", ["event_type"])
    _create_index_once(
        "ix_cloud_session_events_session_seq",
        "cloud_session_events",
        ["session_id", "anyharness_seq"],
    )
    _create_index_once(
        "ix_cloud_session_events_target_session",
        "cloud_session_events",
        ["target_id", "session_id"],
    )
    _create_index_once(
        "ix_cloud_session_events_session_id",
        "cloud_session_events",
        ["session_id"],
    )
    _create_index_once("ix_cloud_session_events_target_id", "cloud_session_events", ["target_id"])

    if not _has_table("cloud_event_ingest_state"):
        op.create_table(
            "cloud_event_ingest_state",
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("session_id", sa.String(length=255), nullable=False),
            sa.Column("worker_id", sa.Uuid(), nullable=True),
            sa.Column("cloud_workspace_id", sa.Uuid(), nullable=True),
            sa.Column("workspace_id", sa.String(length=255), nullable=True),
            sa.Column(
                "last_contiguous_seq",
                sa.Integer(),
                server_default=sa.text("0"),
                nullable=False,
            ),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["cloud_workspace_id"], ["cloud_workspace.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["worker_id"], ["cloud_workers.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("target_id", "session_id"),
        )

    if not _has_table("cloud_sessions"):
        op.create_table(
            "cloud_sessions",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("cloud_workspace_id", sa.Uuid(), nullable=True),
            sa.Column("workspace_id", sa.String(length=255), nullable=True),
            sa.Column("session_id", sa.String(length=255), nullable=False),
            sa.Column("native_session_id", sa.String(length=255), nullable=True),
            sa.Column("source_agent_kind", sa.String(length=64), nullable=True),
            sa.Column("title", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("phase", sa.String(length=64), nullable=True),
            sa.Column("live_config_json", sa.Text(), nullable=True),
            sa.Column("last_event_seq", sa.Integer(), server_default=sa.text("0"), nullable=False),
            sa.Column("last_event_at", sa.String(length=64), nullable=True),
            sa.Column("started_at", sa.String(length=64), nullable=True),
            sa.Column("ended_at", sa.String(length=64), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["cloud_workspace_id"], ["cloud_workspace.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "target_id", "session_id", name="uq_cloud_sessions_target_session"
            ),
        )
    _create_index_once(
        "ix_cloud_sessions_cloud_workspace", "cloud_sessions", ["cloud_workspace_id"]
    )
    _create_index_once("ix_cloud_sessions_last_event_seq", "cloud_sessions", ["last_event_seq"])
    _create_index_once("ix_cloud_sessions_session_id", "cloud_sessions", ["session_id"])
    _create_index_once("ix_cloud_sessions_target_id", "cloud_sessions", ["target_id"])
    _create_index_once(
        "ix_cloud_sessions_target_status", "cloud_sessions", ["target_id", "status"]
    )

    if not _has_table("cloud_transcript_items"):
        op.create_table(
            "cloud_transcript_items",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("cloud_workspace_id", sa.Uuid(), nullable=True),
            sa.Column("workspace_id", sa.String(length=255), nullable=True),
            sa.Column("session_id", sa.String(length=255), nullable=False),
            sa.Column("item_id", sa.String(length=255), nullable=False),
            sa.Column("turn_id", sa.String(length=255), nullable=True),
            sa.Column("kind", sa.String(length=64), nullable=True),
            sa.Column("status", sa.String(length=64), nullable=True),
            sa.Column("source_agent_kind", sa.String(length=64), nullable=True),
            sa.Column("title", sa.Text(), nullable=True),
            sa.Column("text", sa.Text(), nullable=True),
            sa.Column("payload_json", sa.Text(), nullable=True),
            sa.Column("first_seq", sa.Integer(), nullable=False),
            sa.Column("last_seq", sa.Integer(), nullable=False),
            sa.Column("completed_seq", sa.Integer(), nullable=True),
            sa.Column("first_event_at", sa.String(length=64), nullable=True),
            sa.Column("last_event_at", sa.String(length=64), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["cloud_workspace_id"], ["cloud_workspace.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "target_id",
                "session_id",
                "item_id",
                name="uq_cloud_transcript_items_target_session_item",
            ),
        )
    _create_index_once(
        "ix_cloud_transcript_items_cloud_workspace",
        "cloud_transcript_items",
        ["cloud_workspace_id"],
    )
    _create_index_once(
        "ix_cloud_transcript_items_session_id",
        "cloud_transcript_items",
        ["session_id"],
    )
    _create_index_once(
        "ix_cloud_transcript_items_session_seq",
        "cloud_transcript_items",
        ["session_id", "last_seq"],
    )
    _create_index_once(
        "ix_cloud_transcript_items_target_id",
        "cloud_transcript_items",
        ["target_id"],
    )

    if not _has_table("cloud_pending_interactions"):
        op.create_table(
            "cloud_pending_interactions",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("cloud_workspace_id", sa.Uuid(), nullable=True),
            sa.Column("workspace_id", sa.String(length=255), nullable=True),
            sa.Column("session_id", sa.String(length=255), nullable=False),
            sa.Column("request_id", sa.String(length=255), nullable=False),
            sa.Column("kind", sa.String(length=64), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("title", sa.Text(), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("payload_json", sa.Text(), nullable=True),
            sa.Column("requested_seq", sa.Integer(), nullable=False),
            sa.Column("resolved_seq", sa.Integer(), nullable=True),
            sa.Column("requested_at", sa.String(length=64), nullable=True),
            sa.Column("resolved_at", sa.String(length=64), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["cloud_workspace_id"], ["cloud_workspace.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "target_id",
                "session_id",
                "request_id",
                name="uq_cloud_pending_interactions_target_session_request",
            ),
        )
    _create_index_once(
        "ix_cloud_pending_interactions_cloud_workspace",
        "cloud_pending_interactions",
        ["cloud_workspace_id"],
    )
    _create_index_once(
        "ix_cloud_pending_interactions_session_id",
        "cloud_pending_interactions",
        ["session_id"],
    )
    _create_index_once(
        "ix_cloud_pending_interactions_session_status",
        "cloud_pending_interactions",
        ["session_id", "status"],
    )
    _create_index_once(
        "ix_cloud_pending_interactions_target_id",
        "cloud_pending_interactions",
        ["target_id"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    _drop_index_once("ix_cloud_pending_interactions_target_id", "cloud_pending_interactions")
    _drop_index_once(
        "ix_cloud_pending_interactions_session_status",
        "cloud_pending_interactions",
    )
    _drop_index_once("ix_cloud_pending_interactions_session_id", "cloud_pending_interactions")
    _drop_index_once(
        "ix_cloud_pending_interactions_cloud_workspace",
        "cloud_pending_interactions",
    )
    _drop_table_once("cloud_pending_interactions")

    _drop_index_once("ix_cloud_transcript_items_target_id", "cloud_transcript_items")
    _drop_index_once("ix_cloud_transcript_items_session_seq", "cloud_transcript_items")
    _drop_index_once("ix_cloud_transcript_items_session_id", "cloud_transcript_items")
    _drop_index_once("ix_cloud_transcript_items_cloud_workspace", "cloud_transcript_items")
    _drop_table_once("cloud_transcript_items")

    _drop_index_once("ix_cloud_sessions_target_status", "cloud_sessions")
    _drop_index_once("ix_cloud_sessions_target_id", "cloud_sessions")
    _drop_index_once("ix_cloud_sessions_session_id", "cloud_sessions")
    _drop_index_once("ix_cloud_sessions_last_event_seq", "cloud_sessions")
    _drop_index_once("ix_cloud_sessions_cloud_workspace", "cloud_sessions")
    _drop_table_once("cloud_sessions")

    _drop_table_once("cloud_event_ingest_state")

    _drop_index_once("ix_cloud_session_events_target_id", "cloud_session_events")
    _drop_index_once("ix_cloud_session_events_session_id", "cloud_session_events")
    _drop_index_once("ix_cloud_session_events_target_session", "cloud_session_events")
    _drop_index_once("ix_cloud_session_events_session_seq", "cloud_session_events")
    _drop_index_once("ix_cloud_session_events_type", "cloud_session_events")
    _drop_index_once("ix_cloud_session_events_cloud_workspace", "cloud_session_events")
    _drop_table_once("cloud_session_events")
