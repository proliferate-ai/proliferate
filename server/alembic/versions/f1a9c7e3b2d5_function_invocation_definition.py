"""function invocation definition (track 1b phase 2)

Revision ID: f1a9c7e3b2d5
Revises: 5a8fb6df734b
Create Date: 2026-07-09 12:00:00.000000

Track 1b phase 2 (function invocations, Part II mental-model §1): a user-authored
HTTP function the agent can invoke through the integration gateway under the
reserved ``functions`` namespace. Person-scoped (``owner_user_id``); headers are a
Fernet-encrypted JSON blob (write-only); ``args_schema_json`` is validated at the
gateway (jsonschema) then merged into the request. New rows are workflow-only until
``chat_scope_enabled`` is set (§2 default access modes). Idempotent-guarded like the
rest of the stack; chains onto the single v1 head.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1a9c7e3b2d5"
down_revision: str | Sequence[str] | None = "5a8fb6df734b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    return bool(
        bind.execute(
            sa.text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = current_schema() AND table_name = :table_name)"
            ),
            {"table_name": table_name},
        ).scalar()
    )


def upgrade() -> None:
    if not _has_table("function_invocation_definition"):
        op.create_table(
            "function_invocation_definition",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("owner_user_id", sa.Uuid(), nullable=False),
            sa.Column("organization_id", sa.Uuid(), nullable=True),
            sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
            sa.Column("name", sa.String(length=64), nullable=False),
            sa.Column("display_name", sa.String(length=255), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("endpoint_url", sa.Text(), nullable=False),
            sa.Column("method", sa.String(length=8), nullable=False),
            sa.Column("headers_ciphertext", sa.Text(), nullable=True),
            sa.Column(
                "args_schema_json",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                server_default=sa.text("'{}'::jsonb"),
            ),
            sa.Column(
                "chat_scope_enabled",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
            sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "method IN ('get', 'post', 'patch', 'put', 'delete')",
                name="ck_function_invocation_definition_method",
            ),
            sa.ForeignKeyConstraint(
                ["owner_user_id"], ["user.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["created_by_user_id"], ["user.id"], ondelete="SET NULL"
            ),
        )
        op.create_index(
            "uq_function_invocation_definition_owner_name",
            "function_invocation_definition",
            ["owner_user_id", "name"],
            unique=True,
            postgresql_where=sa.text("archived_at IS NULL"),
        )
        op.create_index(
            "ix_function_invocation_definition_owner_active",
            "function_invocation_definition",
            ["owner_user_id"],
            postgresql_where=sa.text("archived_at IS NULL"),
        )
        op.create_index(
            "ix_function_invocation_definition_organization_id",
            "function_invocation_definition",
            ["organization_id"],
        )


def downgrade() -> None:
    if _has_table("function_invocation_definition"):
        op.drop_table("function_invocation_definition")
