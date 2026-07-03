"""agent auth selection rebuild

Destructive P1 auth-model rebuild (codex/p1-auth-contract.md §1). Replaces the
route-selection wiring with ``agent_auth_selection`` (source_kind gateway|api_key,
no native, no slot) and re-shapes ``agent_api_key`` into a titled, provider-less
vault. No users exist, so there is no data migration.

Revision ID: c9b8a7d6e5f4
Revises: c3f7a1e9d2b4
Create Date: 2026-07-02 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c9b8a7d6e5f4"
down_revision: str | Sequence[str] | None = "c3f7a1e9d2b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _create_agent_api_key() -> None:
    op.create_table(
        "agent_api_key",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("value_ciphertext", sa.Text(), nullable=False),
        sa.Column("encryption_key_id", sa.Text(), nullable=False),
        sa.Column("redacted_hint", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('active', 'revoked')",
            name="ck_agent_api_key_status",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_api_key_user_id", "agent_api_key", ["user_id"])
    op.create_index(
        "ix_agent_api_key_user_status",
        "agent_api_key",
        ["user_id", "status"],
    )


def _create_agent_auth_selection() -> None:
    op.create_table(
        "agent_auth_selection",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("harness_kind", sa.String(length=64), nullable=False),
        sa.Column("surface", sa.Text(), nullable=False),
        sa.Column("source_kind", sa.Text(), nullable=False),
        sa.Column("api_key_id", sa.Uuid(), nullable=True),
        sa.Column("env_var_name", sa.Text(), nullable=True),
        sa.Column("provider_hint", sa.Text(), nullable=True),
        sa.Column(
            "enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "surface IN ('local', 'cloud')",
            name="ck_agent_auth_selection_surface",
        ),
        sa.CheckConstraint(
            "source_kind IN ('gateway', 'api_key')",
            name="ck_agent_auth_selection_source_kind",
        ),
        sa.CheckConstraint(
            "source_kind != 'api_key' OR (api_key_id IS NOT NULL AND env_var_name IS NOT NULL)",
            name="ck_agent_auth_selection_api_key_shape",
        ),
        sa.CheckConstraint(
            "source_kind != 'gateway' OR (api_key_id IS NULL AND env_var_name IS NULL)",
            name="ck_agent_auth_selection_gateway_shape",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["api_key_id"],
            ["agent_api_key.id"],
            # CASCADE so deleting a key removes its api_key rows rather than
            # nulling api_key_id and violating ck_..._api_key_shape.
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "harness_kind",
            "surface",
            "source_kind",
            "env_var_name",
            name="uq_agent_auth_selection_scope",
        ),
    )
    op.create_index(
        "ix_agent_auth_selection_user_id",
        "agent_auth_selection",
        ["user_id"],
    )
    op.create_index(
        "ix_agent_auth_selection_api_key_id",
        "agent_auth_selection",
        ["api_key_id"],
    )
    # The scope UNIQUE treats gateway rows (env_var_name IS NULL) as distinct,
    # so enforce "at most one gateway per scope" with a partial unique index.
    op.create_index(
        "ux_agent_auth_selection_gateway",
        "agent_auth_selection",
        ["user_id", "harness_kind", "surface"],
        unique=True,
        postgresql_where=sa.text("source_kind = 'gateway'"),
    )


def upgrade() -> None:
    # Drop the child (route selection) before the key it references.
    if _has_table("agent_auth_route_selection"):
        op.drop_table("agent_auth_route_selection")
    if _has_table("agent_api_key"):
        op.drop_table("agent_api_key")

    _create_agent_api_key()
    _create_agent_auth_selection()


def downgrade() -> None:
    if _has_table("agent_auth_selection"):
        op.drop_table("agent_auth_selection")
    if _has_table("agent_api_key"):
        op.drop_table("agent_api_key")

    # Restore the pre-P1 shape (agent_api_key with provider + the slotted
    # agent_auth_route_selection) so a downgrade lands back on c3f7a1e9d2b4.
    op.create_table(
        "agent_api_key",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.Column("payload_ciphertext_key_id", sa.String(length=255), nullable=False),
        sa.Column("redacted_hint", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("last_validated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "provider IN ('anthropic', 'openai', 'xai', 'google', 'other')",
            name="ck_agent_api_key_provider",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'revoked')",
            name="ck_agent_api_key_status",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_api_key_user_id", "agent_api_key", ["user_id"])
    op.create_index(
        "ix_agent_api_key_user_status",
        "agent_api_key",
        ["user_id", "status"],
    )

    op.create_table(
        "agent_auth_route_selection",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("harness_kind", sa.String(length=64), nullable=False),
        sa.Column("surface", sa.String(length=16), nullable=False),
        sa.Column("route", sa.String(length=16), nullable=False),
        sa.Column("api_key_id", sa.Uuid(), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "slot",
            sa.String(length=32),
            nullable=False,
            server_default="primary",
        ),
        sa.CheckConstraint(
            "surface IN ('local', 'cloud')",
            name="ck_agent_auth_route_selection_surface",
        ),
        sa.CheckConstraint(
            "route IN ('native', 'api_key', 'gateway')",
            name="ck_agent_auth_route_selection_route",
        ),
        sa.CheckConstraint(
            "surface != 'cloud' OR route != 'native'",
            name="ck_agent_auth_route_selection_cloud_route",
        ),
        sa.CheckConstraint(
            "(route != 'api_key') OR (api_key_id IS NOT NULL)",
            name="ck_agent_auth_route_selection_api_key_ref",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["api_key_id"],
            ["agent_api_key.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "harness_kind",
            "surface",
            "slot",
            name="uq_agent_auth_route_selection_scope",
        ),
    )
    op.create_index(
        "ix_agent_auth_route_selection_user_id",
        "agent_auth_route_selection",
        ["user_id"],
    )
    op.create_index(
        "ix_agent_auth_route_selection_api_key_id",
        "agent_auth_route_selection",
        ["api_key_id"],
    )
