"""support report lifecycle

Revision ID: 4d5e6f708192
Revises: 3c4d5e6f7081
Create Date: 2026-05-31 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "4d5e6f708192"
down_revision: str | Sequence[str] | None = "3c4d5e6f7081"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return index_name in {
        index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table_name)
    }


def upgrade() -> None:
    if not _has_table("support_report"):
        op.create_table(
            "support_report",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column("client_job_id", sa.String(length=128), nullable=False),
            sa.Column(
                "owner_user_id",
                sa.UUID(),
                sa.ForeignKey("user.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "primary_organization_id",
                sa.UUID(),
                sa.ForeignKey("organization.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("primary_tenant_id", sa.String(length=128), nullable=False),
            sa.Column("tenant_ids_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="created"),
            sa.Column("s3_bucket", sa.String(length=255), nullable=False),
            sa.Column("s3_prefix", sa.Text(), nullable=False),
            sa.Column(
                "source_surface",
                sa.String(length=32),
                nullable=False,
                server_default="desktop",
            ),
            sa.Column("source_context_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("workspace_refs_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("telemetry_refs_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("object_manifest_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("request_id", sa.String(length=128), nullable=True),
            sa.Column("complete_request_id", sa.String(length=128), nullable=True),
            sa.Column("request_object_written_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "cloud_diagnostics_status",
                sa.String(length=32),
                nullable=False,
                server_default="not_applicable",
            ),
            sa.Column("cloud_diagnostics_error", sa.Text(), nullable=True),
            sa.Column("cloud_diagnostics_started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("cloud_diagnostics_completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("slack_notified_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(
                "status IN ('created','uploading','completed','failed','abandoned')",
                name="ck_support_report_status",
            ),
            sa.CheckConstraint(
                "cloud_diagnostics_status IN "
                "('not_applicable','pending','running','completed','failed','skipped')",
                name="ck_support_report_cloud_diagnostics_status",
            ),
            sa.CheckConstraint(
                "source_surface IN ('desktop','web','mobile','cloud_api')",
                name="ck_support_report_source_surface",
            ),
            sa.UniqueConstraint(
                "owner_user_id",
                "client_job_id",
                name="uq_support_report_owner_client_job",
            ),
        )

    _create_index_once("ix_support_report_owner_user_id", "support_report", ["owner_user_id"])
    _create_index_once(
        "ix_support_report_primary_tenant_id",
        "support_report",
        ["primary_tenant_id"],
    )
    _create_index_once(
        "ix_support_report_primary_organization_id",
        "support_report",
        ["primary_organization_id"],
    )
    _create_index_once(
        "ix_support_report_status_created_at",
        "support_report",
        ["status", "created_at"],
    )


def downgrade() -> None:
    _drop_index_once("ix_support_report_status_created_at", "support_report")
    _drop_index_once("ix_support_report_primary_organization_id", "support_report")
    _drop_index_once("ix_support_report_primary_tenant_id", "support_report")
    _drop_index_once("ix_support_report_owner_user_id", "support_report")
    if _has_table("support_report"):
        op.drop_table("support_report")


def _create_index_once(index_name: str, table_name: str, columns: list[str]) -> None:
    if not _has_index(table_name, index_name):
        op.create_index(index_name, table_name, columns)


def _drop_index_once(index_name: str, table_name: str) -> None:
    if _has_index(table_name, index_name):
        op.drop_index(index_name, table_name=table_name)
