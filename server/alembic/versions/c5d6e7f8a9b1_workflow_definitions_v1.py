"""workflow definitions v1

Revision ID: c5d6e7f8a9b1
Revises: b3c4d5e6f7a9
Create Date: 2026-07-12 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c5d6e7f8a9b1"
down_revision: str | Sequence[str] | None = "b3c4d5e6f7a9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table("workflow_definition"):
        return
    op.create_table(
        "workflow_definition",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column(
            "description",
            sa.Text(),
            server_default=sa.text("''"),
            nullable=False,
        ),
        sa.Column("schema_version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("revision", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("validated_catalog_version", sa.String(length=128), nullable=False),
        sa.Column("default_repo_config_id", sa.Uuid(), nullable=True),
        sa.Column(
            "inputs_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "stages_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "schema_version = 1",
            name="ck_workflow_definition_schema_version",
        ),
        sa.CheckConstraint(
            "revision >= 1",
            name="ck_workflow_definition_revision",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["default_repo_config_id"],
            ["repo_config.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_workflow_definition_user_updated",
        "workflow_definition",
        ["user_id", "updated_at", "id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_workflow_definition_default_repo_config_id",
        "workflow_definition",
        ["default_repo_config_id"],
    )


def downgrade() -> None:
    if _has_table("workflow_definition"):
        op.drop_table("workflow_definition")
