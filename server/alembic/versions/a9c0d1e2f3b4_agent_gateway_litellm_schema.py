"""agent gateway litellm schema

Creates the LiteLLM-era agent auth tables in PR 3 of the agent-auth migration:
personal API key pool, route selections, gateway enrollment, catalog snapshots
and overrides, flag-only org policy, and the usage ledger + import cursor.

Revision ID: a9c0d1e2f3b4
Revises: f8b9c0d1e2a3
Create Date: 2026-07-01 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a9c0d1e2f3b4"
down_revision: str | Sequence[str] | None = "f8b9c0d1e2a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def upgrade() -> None:
    if not _has_table("agent_api_key"):
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

    if not _has_table("agent_auth_route_selection"):
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
                # CASCADE so deleting a key removes its api_key-route selections
                # rather than nulling api_key_id and violating ck_..._api_key_ref.
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "user_id",
                "harness_kind",
                "surface",
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

    if not _has_table("agent_gateway_enrollment"):
        op.create_table(
            "agent_gateway_enrollment",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("subject_kind", sa.String(length=16), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=True),
            sa.Column("organization_id", sa.Uuid(), nullable=True),
            sa.Column("billing_subject_id", sa.Uuid(), nullable=False),
            sa.Column("litellm_team_id", sa.String(length=255), nullable=True),
            sa.Column("litellm_user_id", sa.String(length=255), nullable=True),
            sa.Column("virtual_key_id", sa.String(length=255), nullable=True),
            sa.Column("virtual_key_ciphertext", sa.Text(), nullable=True),
            sa.Column(
                "virtual_key_ciphertext_key_id",
                sa.String(length=255),
                nullable=True,
            ),
            sa.Column("sync_status", sa.String(length=16), nullable=False),
            sa.Column("sync_fingerprint", sa.String(length=128), nullable=True),
            sa.Column("last_error_code", sa.String(length=128), nullable=True),
            sa.Column("last_error_message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(
                "subject_kind IN ('user', 'organization')",
                name="ck_agent_gateway_enrollment_subject_kind",
            ),
            sa.CheckConstraint(
                # Org enrollment is per (member, org): user_id required for both
                # kinds so each member gets their own virtual key (spec §2.3).
                "(subject_kind = 'user' AND user_id IS NOT NULL "
                "AND organization_id IS NULL) OR "
                "(subject_kind = 'organization' AND organization_id IS NOT NULL "
                "AND user_id IS NOT NULL)",
                name="ck_agent_gateway_enrollment_subject_shape",
            ),
            sa.CheckConstraint(
                "sync_status IN ('pending', 'synced', 'failed')",
                name="ck_agent_gateway_enrollment_sync_status",
            ),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["organization_id"],
                ["organization.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["billing_subject_id"],
                ["billing_subject.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_agent_gateway_enrollment_user_id",
            "agent_gateway_enrollment",
            ["user_id"],
        )
        op.create_index(
            "ix_agent_gateway_enrollment_organization_id",
            "agent_gateway_enrollment",
            ["organization_id"],
        )
        op.create_index(
            "ix_agent_gateway_enrollment_billing_subject_id",
            "agent_gateway_enrollment",
            ["billing_subject_id"],
        )
        op.create_index(
            "ix_agent_gateway_enrollment_sync_status",
            "agent_gateway_enrollment",
            ["sync_status"],
        )
        op.create_index(
            "ux_agent_gateway_enrollment_active_user",
            "agent_gateway_enrollment",
            ["user_id"],
            unique=True,
            postgresql_where=sa.text("subject_kind = 'user' AND revoked_at IS NULL"),
        )
        op.create_index(
            "ux_agent_gateway_enrollment_active_organization",
            "agent_gateway_enrollment",
            ["organization_id", "user_id"],
            unique=True,
            postgresql_where=sa.text("subject_kind = 'organization' AND revoked_at IS NULL"),
        )

    if not _has_table("agent_catalog_snapshot"):
        op.create_table(
            "agent_catalog_snapshot",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("harness_kind", sa.String(length=64), nullable=False),
            sa.Column("surface", sa.String(length=16), nullable=False),
            sa.Column("route", sa.String(length=16), nullable=False),
            sa.Column("owner_user_id", sa.Uuid(), nullable=True),
            sa.Column("models_json", sa.Text(), nullable=False),
            sa.Column("probed_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("source", sa.String(length=16), nullable=False),
            sa.Column("status", sa.String(length=16), nullable=False),
            sa.CheckConstraint(
                "surface IN ('local', 'cloud')",
                name="ck_agent_catalog_snapshot_surface",
            ),
            sa.CheckConstraint(
                "route IN ('native', 'api_key', 'gateway')",
                name="ck_agent_catalog_snapshot_route",
            ),
            sa.CheckConstraint(
                "source IN ('probe', 'seed', 'override')",
                name="ck_agent_catalog_snapshot_source",
            ),
            sa.ForeignKeyConstraint(
                ["owner_user_id"],
                ["user.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_agent_catalog_snapshot_owner_user_id",
            "agent_catalog_snapshot",
            ["owner_user_id"],
        )
        op.create_index(
            "ix_agent_catalog_snapshot_scope",
            "agent_catalog_snapshot",
            ["harness_kind", "surface", "route", "owner_user_id", "probed_at"],
        )

    if not _has_table("agent_catalog_override"):
        op.create_table(
            "agent_catalog_override",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("owner_user_id", sa.Uuid(), nullable=True),
            sa.Column("organization_id", sa.Uuid(), nullable=True),
            sa.Column("harness_kind", sa.String(length=64), nullable=False),
            sa.Column("patch_json", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "(owner_user_id IS NOT NULL AND organization_id IS NULL) OR "
                "(organization_id IS NOT NULL AND owner_user_id IS NULL)",
                name="ck_agent_catalog_override_owner_shape",
            ),
            sa.ForeignKeyConstraint(
                ["owner_user_id"],
                ["user.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["organization_id"],
                ["organization.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_agent_catalog_override_owner_user_id",
            "agent_catalog_override",
            ["owner_user_id"],
        )
        op.create_index(
            "ix_agent_catalog_override_organization_id",
            "agent_catalog_override",
            ["organization_id"],
        )
        op.create_index(
            "ux_agent_catalog_override_user_harness",
            "agent_catalog_override",
            ["owner_user_id", "harness_kind"],
            unique=True,
            postgresql_where=sa.text("owner_user_id IS NOT NULL"),
        )
        op.create_index(
            "ux_agent_catalog_override_org_harness",
            "agent_catalog_override",
            ["organization_id", "harness_kind"],
            unique=True,
            postgresql_where=sa.text("organization_id IS NOT NULL"),
        )

    if not _has_table("org_agent_policy"):
        op.create_table(
            "org_agent_policy",
            sa.Column("organization_id", sa.Uuid(), nullable=False),
            sa.Column("allowed_routes_json", sa.Text(), nullable=True),
            sa.Column("allowed_harnesses_json", sa.Text(), nullable=True),
            sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["organization_id"],
                ["organization.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["updated_by_user_id"],
                ["user.id"],
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("organization_id"),
        )

    if not _has_table("agent_llm_usage_event"):
        op.create_table(
            "agent_llm_usage_event",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("litellm_request_id", sa.String(length=255), nullable=False),
            sa.Column("virtual_key_id", sa.String(length=255), nullable=True),
            sa.Column("litellm_team_id", sa.String(length=255), nullable=True),
            sa.Column("user_id", sa.Uuid(), nullable=True),
            sa.Column("organization_id", sa.Uuid(), nullable=True),
            sa.Column("billing_subject_id", sa.Uuid(), nullable=True),
            sa.Column("provider", sa.String(length=64), nullable=True),
            sa.Column("model", sa.String(length=255), nullable=True),
            sa.Column("prompt_tokens", sa.BigInteger(), nullable=False),
            sa.Column("completion_tokens", sa.BigInteger(), nullable=False),
            sa.Column("total_tokens", sa.BigInteger(), nullable=False),
            sa.Column("cost_usd", sa.Numeric(18, 8), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("workspace_id", sa.String(length=255), nullable=True),
            sa.Column("session_id", sa.String(length=255), nullable=True),
            sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("raw_metadata_json", sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(
                ["organization_id"],
                ["organization.id"],
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["billing_subject_id"],
                ["billing_subject.id"],
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "litellm_request_id",
                name="uq_agent_llm_usage_event_litellm_request_id",
            ),
        )
        op.create_index(
            "ix_agent_llm_usage_event_user_occurred",
            "agent_llm_usage_event",
            ["user_id", "occurred_at"],
        )
        op.create_index(
            "ix_agent_llm_usage_event_org_occurred",
            "agent_llm_usage_event",
            ["organization_id", "occurred_at"],
        )
        op.create_index(
            "ix_agent_llm_usage_event_subject_occurred",
            "agent_llm_usage_event",
            ["billing_subject_id", "occurred_at"],
        )

    if not _has_table("agent_llm_usage_import_cursor"):
        op.create_table(
            "agent_llm_usage_import_cursor",
            sa.Column("id", sa.String(length=16), nullable=False),
            sa.Column("last_seen_occurred_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_polled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("last_error_code", sa.String(length=128), nullable=True),
            sa.Column("last_error_message", sa.Text(), nullable=True),
            sa.Column("metadata_json", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "id = 'default'",
                name="ck_agent_llm_usage_import_cursor_singleton",
            ),
            sa.PrimaryKeyConstraint("id"),
        )


def downgrade() -> None:
    # Children before parents so plain DROP TABLE respects foreign keys.
    for table_name in (
        "agent_llm_usage_import_cursor",
        "agent_llm_usage_event",
        "org_agent_policy",
        "agent_catalog_override",
        "agent_catalog_snapshot",
        "agent_gateway_enrollment",
        "agent_auth_route_selection",
        "agent_api_key",
    ):
        if _has_table(table_name):
            op.drop_table(table_name)
