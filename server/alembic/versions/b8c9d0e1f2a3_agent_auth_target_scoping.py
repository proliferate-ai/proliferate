"""agent auth per-target scoping

Reintroduces a minimal ``cloud_targets`` registry (the #803/#809 cutover
dropped the pre-cutover table; the ssh/personal-target design §3.1 brings it
back as the ownership anchor) and adds a nullable ``target_id`` to
``agent_auth_route_selection``. ``target_id`` NULL keeps today's default
direct-surface and cloud rows; a non-NULL value scopes a local-surface row to
one enrolled runtime.

The unique scope widens from (user, harness, surface, slot) to include
``target_id``. Postgres treats NULLs as pairwise distinct inside a plain
unique constraint, which would allow duplicate default rows and break the
store's ON CONFLICT upsert — so the single named constraint is replaced by a
pair of partial unique indexes (the codebase's established pattern for
NULL-split uniqueness, e.g. ``ux_agent_gateway_enrollment_active_user``).

Revision ID: b8c9d0e1f2a3
Revises: e5f6a7b8c9d0
Create Date: 2026-07-02 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b8c9d0e1f2a3"
down_revision: str | Sequence[str] | None = "e5f6a7b8c9d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "agent_auth_route_selection"
_UNIQUE = "uq_agent_auth_route_selection_scope"
_UNIQUE_DEFAULT = "uq_agent_auth_route_selection_default"
_UNIQUE_TARGET = "uq_agent_auth_route_selection_target"
_TARGET_SURFACE_CHECK = "ck_agent_auth_route_selection_target_surface"
_TARGET_FK = "fk_agent_auth_route_selection_target_id"
_TARGETS_TABLE = "cloud_targets"


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table(_TARGETS_TABLE):
        op.create_table(
            _TARGETS_TABLE,
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("display_name", sa.String(length=255), nullable=False),
            sa.Column("kind", sa.String(length=32), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("owner_scope", sa.String(length=32), nullable=False),
            sa.Column("owner_user_id", sa.Uuid(), nullable=True),
            sa.Column("organization_id", sa.Uuid(), nullable=True),
            sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
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
                "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
                "AND organization_id IS NULL) OR "
                "(owner_scope = 'organization' AND organization_id IS NOT NULL "
                "AND owner_user_id IS NULL))",
                name="ck_cloud_target_owner_fields",
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
        op.create_index("ix_cloud_targets_status", _TARGETS_TABLE, ["status"])
        op.create_index("ix_cloud_targets_owner_user_id", _TARGETS_TABLE, ["owner_user_id"])
        op.create_index("ix_cloud_targets_organization_id", _TARGETS_TABLE, ["organization_id"])
        op.create_index(
            "ix_cloud_targets_created_by_user_id",
            _TARGETS_TABLE,
            ["created_by_user_id"],
        )
        op.create_index(
            "ix_cloud_targets_owner_user_status",
            _TARGETS_TABLE,
            ["owner_user_id", "status"],
        )
        op.create_index(
            "ix_cloud_targets_organization_status",
            _TARGETS_TABLE,
            ["organization_id", "status"],
        )

    op.add_column(_TABLE, sa.Column("target_id", sa.Uuid(), nullable=True))
    op.create_index(
        "ix_agent_auth_route_selection_target_id",
        _TABLE,
        ["target_id"],
    )
    op.create_foreign_key(
        _TARGET_FK,
        _TABLE,
        _TARGETS_TABLE,
        ["target_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_check_constraint(
        _TARGET_SURFACE_CHECK,
        _TABLE,
        "target_id IS NULL OR surface = 'local'",
    )
    op.drop_constraint(_UNIQUE, _TABLE, type_="unique")
    op.create_index(
        _UNIQUE_DEFAULT,
        _TABLE,
        ["user_id", "harness_kind", "surface", "slot"],
        unique=True,
        postgresql_where=sa.text("target_id IS NULL"),
    )
    op.create_index(
        _UNIQUE_TARGET,
        _TABLE,
        ["user_id", "harness_kind", "surface", "target_id", "slot"],
        unique=True,
        postgresql_where=sa.text("target_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(_UNIQUE_TARGET, table_name=_TABLE)
    op.drop_index(_UNIQUE_DEFAULT, table_name=_TABLE)
    # Target-scoped overrides have no representation under the narrower key.
    op.execute(sa.text(f"DELETE FROM {_TABLE} WHERE target_id IS NOT NULL"))
    op.drop_constraint(_TARGET_SURFACE_CHECK, _TABLE, type_="check")
    op.drop_constraint(_TARGET_FK, _TABLE, type_="foreignkey")
    op.drop_index("ix_agent_auth_route_selection_target_id", table_name=_TABLE)
    op.drop_column(_TABLE, "target_id")
    op.create_unique_constraint(
        _UNIQUE,
        _TABLE,
        ["user_id", "harness_kind", "surface", "slot"],
    )
    if _has_table(_TARGETS_TABLE):
        op.drop_table(_TARGETS_TABLE)
