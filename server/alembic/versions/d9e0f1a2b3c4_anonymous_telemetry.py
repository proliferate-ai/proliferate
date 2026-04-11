"""anonymous telemetry

Revision ID: d9e0f1a2b3c4
Revises: a5b6c7d8e9f0
Create Date: 2026-04-13 10:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d9e0f1a2b3c4"
down_revision: str | Sequence[str] | None = "b6c7d8e9f0a1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in set(inspector.get_table_names())


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_table("anonymous_telemetry_install"):
        op.create_table(
            "anonymous_telemetry_install",
            sa.Column("install_uuid", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("surface", sa.String(length=32), nullable=False),
            sa.Column("last_telemetry_mode", sa.String(length=32), nullable=False),
            sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_app_version", sa.String(length=255), nullable=True),
            sa.Column("last_platform", sa.String(length=64), nullable=True),
            sa.Column("last_arch", sa.String(length=64), nullable=True),
            sa.PrimaryKeyConstraint("install_uuid", "surface"),
        )

    if not _has_table("anonymous_telemetry_event"):
        op.create_table(
            "anonymous_telemetry_event",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("install_uuid", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("surface", sa.String(length=32), nullable=False),
            sa.Column("telemetry_mode", sa.String(length=32), nullable=False),
            sa.Column("record_type", sa.String(length=32), nullable=False),
            sa.Column("payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
            sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
    if not _has_index("anonymous_telemetry_event", "ix_anonymous_telemetry_event_install_uuid"):
        op.create_index(
            "ix_anonymous_telemetry_event_install_uuid",
            "anonymous_telemetry_event",
            ["install_uuid"],
            unique=False,
        )
    if not _has_index("anonymous_telemetry_event", "ix_anonymous_telemetry_event_surface"):
        op.create_index(
            "ix_anonymous_telemetry_event_surface",
            "anonymous_telemetry_event",
            ["surface"],
            unique=False,
        )

    if not _has_table("anonymous_telemetry_local_install"):
        op.create_table(
            "anonymous_telemetry_local_install",
            sa.Column("surface", sa.String(length=32), nullable=False),
            sa.Column("install_uuid", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("surface"),
            sa.UniqueConstraint("install_uuid"),
        )


def downgrade() -> None:
    """Downgrade schema."""
    if _has_table("anonymous_telemetry_local_install"):
        op.drop_table("anonymous_telemetry_local_install")

    if _has_table("anonymous_telemetry_event"):
        if _has_index("anonymous_telemetry_event", "ix_anonymous_telemetry_event_surface"):
            op.drop_index(
                "ix_anonymous_telemetry_event_surface",
                table_name="anonymous_telemetry_event",
            )
        if _has_index("anonymous_telemetry_event", "ix_anonymous_telemetry_event_install_uuid"):
            op.drop_index(
                "ix_anonymous_telemetry_event_install_uuid",
                table_name="anonymous_telemetry_event",
            )
        op.drop_table("anonymous_telemetry_event")

    if _has_table("anonymous_telemetry_install"):
        op.drop_table("anonymous_telemetry_install")
