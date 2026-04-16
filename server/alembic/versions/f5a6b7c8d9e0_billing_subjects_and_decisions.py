"""billing subjects and decision events

Revision ID: f5a6b7c8d9e0
Revises: e3f4a5b6c7d8
Create Date: 2026-04-18 10:00:00.000000

"""

from collections.abc import Sequence
from datetime import UTC, datetime
import uuid

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f5a6b7c8d9e0"
down_revision: str | Sequence[str] | None = "e3f4a5b6c7d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _user_ids(bind: sa.Connection) -> list[uuid.UUID]:
    rows = bind.execute(
        sa.text(
            """
            SELECT id FROM "user"
            UNION
            SELECT user_id FROM billing_grant
            UNION
            SELECT user_id FROM billing_entitlement
            UNION
            SELECT user_id FROM usage_segment
            UNION
            SELECT user_id FROM cloud_workspace
            """
        )
    )
    return [row[0] for row in rows]


def _subject_ids_by_user(bind: sa.Connection) -> dict[uuid.UUID, uuid.UUID]:
    rows = bind.execute(
        sa.text(
            """
            SELECT user_id, id
            FROM billing_subject
            WHERE kind = 'personal' AND user_id IS NOT NULL
            """
        )
    )
    return {row[0]: row[1] for row in rows}


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


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
    if not _has_table("billing_subject"):
        op.create_table(
            "billing_subject",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("kind", sa.String(length=32), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=True),
            sa.Column("organization_id", sa.Uuid(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_billing_subject_kind", "billing_subject", ["kind"])
    _create_index_once(
        "ix_billing_subject_organization_id",
        "billing_subject",
        ["organization_id"],
    )
    _create_index_once("ix_billing_subject_user_id", "billing_subject", ["user_id"], unique=True)

    if not _has_table("billing_hold"):
        op.create_table(
            "billing_hold",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("billing_subject_id", sa.Uuid(), nullable=False),
            sa.Column("kind", sa.String(length=64), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("source", sa.String(length=64), nullable=False),
            sa.Column("source_ref", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_enforced_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once(
        "ix_billing_hold_billing_subject_id",
        "billing_hold",
        ["billing_subject_id"],
    )
    _create_index_once("ix_billing_hold_kind", "billing_hold", ["kind"])
    _create_index_once("ix_billing_hold_status", "billing_hold", ["status"])

    if not _has_table("billing_decision_event"):
        op.create_table(
            "billing_decision_event",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("billing_subject_id", sa.Uuid(), nullable=False),
            sa.Column("actor_user_id", sa.Uuid(), nullable=True),
            sa.Column("workspace_id", sa.Uuid(), nullable=True),
            sa.Column("decision_type", sa.String(length=64), nullable=False),
            sa.Column("mode", sa.String(length=32), nullable=False),
            sa.Column("would_block_start", sa.Boolean(), nullable=False),
            sa.Column("would_pause_active", sa.Boolean(), nullable=False),
            sa.Column("reason", sa.String(length=64), nullable=True),
            sa.Column("active_sandbox_count", sa.Integer(), nullable=False),
            sa.Column("remaining_seconds", sa.Float(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once(
        "ix_billing_decision_event_billing_subject_id",
        "billing_decision_event",
        ["billing_subject_id"],
    )
    _create_index_once(
        "ix_billing_decision_event_actor_user_id",
        "billing_decision_event",
        ["actor_user_id"],
    )
    _create_index_once(
        "ix_billing_decision_event_workspace_id",
        "billing_decision_event",
        ["workspace_id"],
    )
    _create_index_once(
        "ix_billing_decision_event_decision_type",
        "billing_decision_event",
        ["decision_type"],
    )
    _create_index_once("ix_billing_decision_event_mode", "billing_decision_event", ["mode"])

    if not _has_column("billing_grant", "billing_subject_id"):
        op.add_column("billing_grant", sa.Column("billing_subject_id", sa.Uuid(), nullable=True))
    if not _has_column("billing_entitlement", "billing_subject_id"):
        op.add_column(
            "billing_entitlement",
            sa.Column("billing_subject_id", sa.Uuid(), nullable=True),
        )
    if not _has_column("usage_segment", "billing_subject_id"):
        op.add_column("usage_segment", sa.Column("billing_subject_id", sa.Uuid(), nullable=True))
    if not _has_column("cloud_workspace", "billing_subject_id"):
        op.add_column("cloud_workspace", sa.Column("billing_subject_id", sa.Uuid(), nullable=True))
    if not _has_column("cloud_workspace", "created_by_user_id"):
        op.add_column("cloud_workspace", sa.Column("created_by_user_id", sa.Uuid(), nullable=True))

    bind = op.get_bind()
    now = datetime.now(UTC)
    for user_id in _user_ids(bind):
        bind.execute(
            sa.text(
                """
                INSERT INTO billing_subject (id, kind, user_id, organization_id, created_at, updated_at)
                VALUES (:id, 'personal', :user_id, NULL, :created_at, :updated_at)
                ON CONFLICT (user_id) DO NOTHING
                """
            ),
            {
                "id": uuid.uuid4(),
                "user_id": user_id,
                "created_at": now,
                "updated_at": now,
            },
        )

    subject_ids = _subject_ids_by_user(bind)
    for user_id, subject_id in subject_ids.items():
        bind.execute(
            sa.text("UPDATE billing_grant SET billing_subject_id = :subject_id WHERE user_id = :user_id"),
            {"subject_id": subject_id, "user_id": user_id},
        )
        bind.execute(
            sa.text(
                "UPDATE billing_entitlement SET billing_subject_id = :subject_id WHERE user_id = :user_id"
            ),
            {"subject_id": subject_id, "user_id": user_id},
        )
        bind.execute(
            sa.text("UPDATE usage_segment SET billing_subject_id = :subject_id WHERE user_id = :user_id"),
            {"subject_id": subject_id, "user_id": user_id},
        )
        bind.execute(
            sa.text(
                """
                UPDATE cloud_workspace
                SET billing_subject_id = :subject_id,
                    created_by_user_id = user_id
                WHERE user_id = :user_id
                """
            ),
            {"subject_id": subject_id, "user_id": user_id},
        )

    op.alter_column("billing_grant", "billing_subject_id", nullable=False)
    op.alter_column("billing_entitlement", "billing_subject_id", nullable=False)
    op.alter_column("usage_segment", "billing_subject_id", nullable=False)
    op.alter_column("cloud_workspace", "billing_subject_id", nullable=False)
    op.alter_column("cloud_workspace", "created_by_user_id", nullable=False)

    _create_index_once(
        "ix_billing_grant_billing_subject_id",
        "billing_grant",
        ["billing_subject_id"],
    )
    _create_index_once(
        "ix_billing_entitlement_billing_subject_id",
        "billing_entitlement",
        ["billing_subject_id"],
    )
    _create_index_once(
        "ix_usage_segment_billing_subject_id",
        "usage_segment",
        ["billing_subject_id"],
    )
    _create_index_once(
        "ix_cloud_workspace_billing_subject_id",
        "cloud_workspace",
        ["billing_subject_id"],
    )
    _create_index_once(
        "ix_cloud_workspace_created_by_user_id",
        "cloud_workspace",
        ["created_by_user_id"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_cloud_workspace_created_by_user_id", table_name="cloud_workspace")
    op.drop_index("ix_cloud_workspace_billing_subject_id", table_name="cloud_workspace")
    op.drop_index("ix_usage_segment_billing_subject_id", table_name="usage_segment")
    op.drop_index(
        "ix_billing_entitlement_billing_subject_id",
        table_name="billing_entitlement",
    )
    op.drop_index("ix_billing_grant_billing_subject_id", table_name="billing_grant")

    op.drop_column("cloud_workspace", "created_by_user_id")
    op.drop_column("cloud_workspace", "billing_subject_id")
    op.drop_column("usage_segment", "billing_subject_id")
    op.drop_column("billing_entitlement", "billing_subject_id")
    op.drop_column("billing_grant", "billing_subject_id")

    op.drop_index("ix_billing_decision_event_mode", table_name="billing_decision_event")
    op.drop_index(
        "ix_billing_decision_event_decision_type",
        table_name="billing_decision_event",
    )
    op.drop_index("ix_billing_decision_event_workspace_id", table_name="billing_decision_event")
    op.drop_index("ix_billing_decision_event_actor_user_id", table_name="billing_decision_event")
    op.drop_index(
        "ix_billing_decision_event_billing_subject_id",
        table_name="billing_decision_event",
    )
    op.drop_table("billing_decision_event")

    op.drop_index("ix_billing_hold_status", table_name="billing_hold")
    op.drop_index("ix_billing_hold_kind", table_name="billing_hold")
    op.drop_index("ix_billing_hold_billing_subject_id", table_name="billing_hold")
    op.drop_table("billing_hold")

    op.drop_index("ix_billing_subject_user_id", table_name="billing_subject")
    op.drop_index("ix_billing_subject_organization_id", table_name="billing_subject")
    op.drop_index("ix_billing_subject_kind", table_name="billing_subject")
    op.drop_table("billing_subject")
