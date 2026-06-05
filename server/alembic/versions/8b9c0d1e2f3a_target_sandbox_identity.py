"""Collapse managed cloud slot identity to target sandbox identity.

Revision ID: 8b9c0d1e2f3a
Revises: 7a8192b3c4d5
Create Date: 2026-06-04 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "8b9c0d1e2f3a"
down_revision: str | Sequence[str] | None = "7a8192b3c4d5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return _inspector().has_table(table_name)


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {
        column["name"] for column in _inspector().get_columns(table_name)
    }


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return index_name in {index["name"] for index in _inspector().get_indexes(table_name)}


def _has_check(table_name: str, constraint_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return constraint_name in {
        constraint["name"] for constraint in _inspector().get_check_constraints(table_name)
    }


def _has_foreign_key(table_name: str, constraint_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return constraint_name in {
        constraint["name"] for constraint in _inspector().get_foreign_keys(table_name)
    }


def _foreign_keys_for_columns(table_name: str, columns: set[str]) -> list[str]:
    if not _has_table(table_name):
        return []
    names: list[str] = []
    for constraint in _inspector().get_foreign_keys(table_name):
        constrained_columns = set(constraint.get("constrained_columns") or ())
        name = constraint.get("name")
        if name and constrained_columns.intersection(columns):
            names.append(name)
    return names


def _drop_index_once(table_name: str, index_name: str) -> None:
    if _has_index(table_name, index_name):
        op.drop_index(index_name, table_name=table_name)


def _drop_check_once(table_name: str, constraint_name: str) -> None:
    if _has_check(table_name, constraint_name):
        op.drop_constraint(constraint_name, table_name, type_="check")


def _drop_foreign_key_once(table_name: str, constraint_name: str) -> None:
    if _has_foreign_key(table_name, constraint_name):
        op.drop_constraint(constraint_name, table_name, type_="foreignkey")


def _drop_foreign_keys_for_columns(table_name: str, columns: set[str]) -> None:
    for constraint_name in _foreign_keys_for_columns(table_name, columns):
        op.drop_constraint(constraint_name, table_name, type_="foreignkey")


def _drop_column_once(table_name: str, column_name: str) -> None:
    if _has_column(table_name, column_name):
        op.drop_column(table_name, column_name)


def _create_index_once(
    table_name: str,
    index_name: str,
    columns: list[str],
    **kwargs: object,
) -> None:
    if not _has_index(table_name, index_name) and all(
        _has_column(table_name, column) for column in columns
    ):
        op.create_index(index_name, table_name, columns, **kwargs)


def _create_foreign_key_once(
    table_name: str,
    constraint_name: str,
    remote_table: str,
    local_columns: list[str],
    remote_columns: list[str],
    *,
    ondelete: str,
) -> None:
    if not _has_foreign_key(table_name, constraint_name) and all(
        _has_column(table_name, column) for column in local_columns
    ):
        op.create_foreign_key(
            constraint_name,
            table_name,
            remote_table,
            local_columns,
            remote_columns,
            ondelete=ondelete,
        )


def upgrade() -> None:
    _upgrade_cloud_workers_and_enrollments()
    _upgrade_cloud_sandbox()
    _upgrade_target_runtime_access()
    _upgrade_profile_target_state()
    _upgrade_cloud_workspace()
    _upgrade_cloud_commands()
    _upgrade_agent_gateway_runtime_grants()
    _upgrade_agent_gateway_router_materializations()


def downgrade() -> None:
    raise RuntimeError(
        "Downgrade for target sandbox identity collapse is unsupported; migrate forward."
    )


def _upgrade_cloud_workers_and_enrollments() -> None:
    _drop_index_once("cloud_workers", "ix_cloud_workers_cloud_sandbox_id")
    _drop_foreign_keys_for_columns("cloud_workers", {"cloud_sandbox_id"})
    _drop_column_once("cloud_workers", "cloud_sandbox_id")
    _drop_column_once("cloud_workers", "slot_generation")

    _drop_index_once("cloud_target_enrollments", "ix_cloud_target_enrollments_cloud_sandbox_id")
    _drop_foreign_keys_for_columns("cloud_target_enrollments", {"cloud_sandbox_id"})
    _drop_column_once("cloud_target_enrollments", "cloud_sandbox_id")
    _drop_column_once("cloud_target_enrollments", "slot_generation")


def _upgrade_cloud_sandbox() -> None:
    _drop_index_once("cloud_sandbox", "ux_cloud_sandbox_active_slot_per_profile_target")
    _drop_index_once("cloud_sandbox", "ix_cloud_sandbox_superseded_by_sandbox_id")
    _drop_index_once("cloud_sandbox", "ix_cloud_sandbox_runtime_environment_id")
    _drop_index_once("cloud_sandbox", "ix_cloud_sandbox_cloud_workspace_id")
    _drop_check_once("cloud_sandbox", "ck_cloud_sandbox_managed_slot_identity")
    _drop_foreign_keys_for_columns(
        "cloud_sandbox",
        {
            "cloud_workspace_id",
            "runtime_environment_id",
            "superseded_by_sandbox_id",
        },
    )
    _drop_column_once("cloud_sandbox", "slot_generation")
    _drop_column_once("cloud_sandbox", "superseded_by_sandbox_id")
    _drop_column_once("cloud_sandbox", "superseded_at")
    _drop_column_once("cloud_sandbox", "runtime_environment_id")
    _drop_column_once("cloud_sandbox", "cloud_workspace_id")

    if _has_table("cloud_sandbox") and not _has_check(
        "cloud_sandbox",
        "ck_cloud_sandbox_managed_target_identity",
    ):
        op.create_check_constraint(
            "ck_cloud_sandbox_managed_target_identity",
            "cloud_sandbox",
            "(sandbox_profile_id IS NULL AND target_id IS NULL AND billing_subject_id IS NULL) "
            "OR (sandbox_profile_id IS NOT NULL AND target_id IS NOT NULL "
            "AND billing_subject_id IS NOT NULL)",
        )
    _create_index_once(
        "cloud_sandbox",
        "ux_cloud_sandbox_active_per_target",
        ["target_id"],
        unique=True,
        postgresql_where=sa.text(
            "status IN ('creating','provisioning','running','paused','blocked') "
            "AND target_id IS NOT NULL"
        ),
    )


def _upgrade_target_runtime_access() -> None:
    _drop_check_once(
        "cloud_target_runtime_access",
        "ck_cloud_target_runtime_access_active_slot_fields",
    )
    _drop_index_once(
        "cloud_target_runtime_access",
        "ix_cloud_target_runtime_access_active_sandbox_id",
    )
    _drop_foreign_keys_for_columns("cloud_target_runtime_access", {"active_sandbox_id"})
    if _has_column("cloud_target_runtime_access", "active_sandbox_id"):
        if not _has_column("cloud_target_runtime_access", "cloud_sandbox_id"):
            op.alter_column(
                "cloud_target_runtime_access",
                "active_sandbox_id",
                new_column_name="cloud_sandbox_id",
            )
        else:
            op.execute(
                """
                UPDATE cloud_target_runtime_access
                SET cloud_sandbox_id = active_sandbox_id
                WHERE cloud_sandbox_id IS NULL AND active_sandbox_id IS NOT NULL
                """
            )
            op.drop_column("cloud_target_runtime_access", "active_sandbox_id")
    _drop_column_once("cloud_target_runtime_access", "slot_generation")
    _create_foreign_key_once(
        "cloud_target_runtime_access",
        "cloud_target_runtime_access_cloud_sandbox_id_fkey",
        "cloud_sandbox",
        ["cloud_sandbox_id"],
        ["id"],
        ondelete="SET NULL",
    )
    _create_index_once(
        "cloud_target_runtime_access",
        "ix_cloud_target_runtime_access_cloud_sandbox_id",
        ["cloud_sandbox_id"],
    )


def _upgrade_profile_target_state() -> None:
    _drop_check_once(
        "sandbox_profile_target_state",
        "ck_sandbox_profile_target_state_slot_identity",
    )
    _drop_foreign_keys_for_columns("sandbox_profile_target_state", {"active_sandbox_id"})
    _drop_column_once("sandbox_profile_target_state", "active_sandbox_id")
    _drop_column_once("sandbox_profile_target_state", "slot_generation")


def _upgrade_cloud_workspace() -> None:
    if _has_table("cloud_workspace") and not _has_column(
        "cloud_workspace",
        "materialized_target_id",
    ):
        op.add_column("cloud_workspace", sa.Column("materialized_target_id", sa.Uuid()))
    if _has_column("cloud_workspace", "materialized_slot_generation"):
        op.execute(
            """
            UPDATE cloud_workspace
            SET materialized_target_id = target_id
            WHERE materialized_target_id IS NULL
              AND materialized_slot_generation IS NOT NULL
              AND target_id IS NOT NULL
            """
        )
        op.drop_column("cloud_workspace", "materialized_slot_generation")
    _create_foreign_key_once(
        "cloud_workspace",
        "cloud_workspace_materialized_target_id_fkey",
        "cloud_targets",
        ["materialized_target_id"],
        ["id"],
        ondelete="SET NULL",
    )
    _create_index_once(
        "cloud_workspace",
        "ix_cloud_workspace_materialized_target_id",
        ["materialized_target_id"],
    )


def _upgrade_cloud_commands() -> None:
    _drop_index_once("cloud_commands", "ix_cloud_commands_leased_cloud_sandbox_id")
    _drop_foreign_keys_for_columns("cloud_commands", {"leased_cloud_sandbox_id"})
    _drop_column_once("cloud_commands", "leased_cloud_sandbox_id")
    _drop_column_once("cloud_commands", "leased_slot_generation")


def _upgrade_agent_gateway_runtime_grants() -> None:
    _drop_index_once("agent_gateway_runtime_grant", "ix_agent_gateway_runtime_grant_slot")
    _drop_index_once(
        "agent_gateway_runtime_grant",
        "ix_agent_gateway_runtime_grant_cloud_sandbox_id",
    )
    _drop_foreign_keys_for_columns("agent_gateway_runtime_grant", {"cloud_sandbox_id"})
    _drop_column_once("agent_gateway_runtime_grant", "cloud_sandbox_id")
    _drop_column_once("agent_gateway_runtime_grant", "slot_generation")


def _upgrade_agent_gateway_router_materializations() -> None:
    _drop_index_once(
        "agent_gateway_router_materialization",
        "uq_agent_gateway_router_materialization_runtime",
    )
    _drop_index_once(
        "agent_gateway_router_materialization",
        "ix_agent_gateway_router_materialization_cloud_sandbox_id",
    )
    _drop_foreign_keys_for_columns(
        "agent_gateway_router_materialization",
        {"cloud_sandbox_id"},
    )
    _drop_column_once("agent_gateway_router_materialization", "cloud_sandbox_id")
    _drop_column_once("agent_gateway_router_materialization", "slot_generation")
    _create_index_once(
        "agent_gateway_router_materialization",
        "uq_agent_gateway_router_materialization_runtime",
        [
            "router_kind",
            "router_object_kind",
            "object_scope",
            "selection_id",
            "target_id",
        ],
        unique=True,
        postgresql_where=sa.text(
            "object_scope = 'runtime_selection' AND status != 'revoked'"
        ),
    )
