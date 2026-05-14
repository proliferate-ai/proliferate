"""cloud targets and workers

Revision ID: c4d5e6f7a8b9
Revises: c3d4e5f6a7b8
Create Date: 2026-05-13 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4d5e6f7a8b9"
down_revision: str | Sequence[str] | None = "c3d4e5f6a7b8"
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


def _create_index_once(index_name: str, table_name: str, columns: list[str]) -> None:
    if not _has_index(table_name, index_name):
        op.create_index(index_name, table_name, columns, unique=False)


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_table("cloud_targets"):
        op.create_table(
            "cloud_targets",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("display_name", sa.String(length=255), nullable=False),
            sa.Column("kind", sa.String(length=32), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("owner_scope", sa.String(length=32), nullable=False),
            sa.Column("owner_user_id", sa.Uuid(), nullable=False),
            sa.Column("organization_id", sa.Uuid(), nullable=True),
            sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
            sa.Column("default_workspace_root", sa.Text(), nullable=True),
            sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "kind IN ('managed_cloud', 'ssh', 'desktop_dispatch', 'local_direct', "
                "'self_hosted_cloud')",
                name="ck_cloud_targets_kind",
            ),
            sa.CheckConstraint(
                "owner_scope IN ('personal', 'organization')",
                name="ck_cloud_targets_owner_scope",
            ),
            sa.CheckConstraint(
                "status IN ('enrolling', 'online', 'offline', 'degraded', 'archived')",
                name="ck_cloud_targets_status",
            ),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_cloud_targets_status", "cloud_targets", ["status"])
    _create_index_once("ix_cloud_targets_owner_user_id", "cloud_targets", ["owner_user_id"])
    _create_index_once("ix_cloud_targets_organization_id", "cloud_targets", ["organization_id"])
    _create_index_once(
        "ix_cloud_targets_owner_user_status",
        "cloud_targets",
        ["owner_user_id", "status"],
    )
    _create_index_once(
        "ix_cloud_targets_organization_status",
        "cloud_targets",
        ["organization_id", "status"],
    )
    _create_index_once(
        "ix_cloud_targets_created_by_user_id",
        "cloud_targets",
        ["created_by_user_id"],
    )

    if not _has_table("cloud_workers"):
        op.create_table(
            "cloud_workers",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("machine_fingerprint", sa.String(length=255), nullable=True),
            sa.Column("hostname", sa.String(length=255), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("worker_version", sa.String(length=128), nullable=True),
            sa.Column("anyharness_version", sa.String(length=128), nullable=True),
            sa.Column("supervisor_version", sa.String(length=128), nullable=True),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "status IN ('enrolling', 'online', 'offline', 'degraded', 'archived')",
                name="ck_cloud_workers_status",
            ),
            sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("token_hash"),
        )
    _create_index_once("ix_cloud_workers_target_id", "cloud_workers", ["target_id"])
    _create_index_once("ix_cloud_workers_token_hash", "cloud_workers", ["token_hash"])
    _create_index_once("ix_cloud_workers_status", "cloud_workers", ["status"])
    _create_index_once(
        "ix_cloud_workers_target_status",
        "cloud_workers",
        ["target_id", "status"],
    )
    _create_index_once("ix_cloud_workers_last_seen_at", "cloud_workers", ["last_seen_at"])

    if not _has_table("cloud_target_enrollments"):
        op.create_table(
            "cloud_target_enrollments",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "status IN ('pending', 'consumed', 'expired', 'revoked')",
                name="ck_cloud_target_enrollments_status",
            ),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("token_hash"),
        )
    _create_index_once(
        "ix_cloud_target_enrollments_target_id",
        "cloud_target_enrollments",
        ["target_id"],
    )
    _create_index_once(
        "ix_cloud_target_enrollments_token_hash",
        "cloud_target_enrollments",
        ["token_hash"],
    )
    _create_index_once(
        "ix_cloud_target_enrollments_status",
        "cloud_target_enrollments",
        ["status"],
    )
    _create_index_once(
        "ix_cloud_target_enrollments_target_status",
        "cloud_target_enrollments",
        ["target_id", "status"],
    )
    _create_index_once(
        "ix_cloud_target_enrollments_expires_at",
        "cloud_target_enrollments",
        ["expires_at"],
    )
    _create_index_once(
        "ix_cloud_target_enrollments_created_by_user_id",
        "cloud_target_enrollments",
        ["created_by_user_id"],
    )

    if not _has_table("cloud_target_inventory"):
        op.create_table(
            "cloud_target_inventory",
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("worker_id", sa.Uuid(), nullable=True),
            sa.Column("os", sa.String(length=64), nullable=True),
            sa.Column("arch", sa.String(length=64), nullable=True),
            sa.Column("distro", sa.String(length=128), nullable=True),
            sa.Column("shell", sa.String(length=255), nullable=True),
            sa.Column("git_json", sa.Text(), nullable=True),
            sa.Column("node_json", sa.Text(), nullable=True),
            sa.Column("python_json", sa.Text(), nullable=True),
            sa.Column("browser_json", sa.Text(), nullable=True),
            sa.Column("capabilities_json", sa.Text(), nullable=True),
            sa.Column("providers_json", sa.Text(), nullable=True),
            sa.Column("mcp_json", sa.Text(), nullable=True),
            sa.Column("raw_json", sa.Text(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["worker_id"], ["cloud_workers.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("target_id"),
        )
    _create_index_once(
        "ix_cloud_target_inventory_worker_id",
        "cloud_target_inventory",
        ["worker_id"],
    )

    if not _has_table("cloud_target_status"):
        op.create_table(
            "cloud_target_status",
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("worker_id", sa.Uuid(), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("status_detail", sa.Text(), nullable=True),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["worker_id"], ["cloud_workers.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("target_id"),
        )
    _create_index_once("ix_cloud_target_status_status", "cloud_target_status", ["status"])
    _create_index_once("ix_cloud_target_status_worker_id", "cloud_target_status", ["worker_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("cloud_target_status")
    op.drop_table("cloud_target_inventory")
    op.drop_table("cloud_target_enrollments")
    op.drop_table("cloud_workers")
    op.drop_table("cloud_targets")
