"""agent auth provider slots

Revision ID: b0c1d2e3f4a6
Revises: ac2d3e4f5a61
Create Date: 2026-06-08 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b0c1d2e3f4a6"
down_revision: str | Sequence[str] | None = "ac2d3e4f5a61"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PROVIDER_CONSTRAINT = "credential_provider_id IN ('anthropic', 'openai', 'gemini', 'cursor')"
_SHARE_PROVIDER_CONSTRAINT = (
    "allowed_credential_provider_id IN ('anthropic', 'openai', 'gemini', 'cursor')"
)
_AGENT_KIND_CONSTRAINT = "agent_kind IN ('claude', 'codex', 'opencode', 'gemini')"


def _inspector() -> sa.engine.reflection.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {column["name"] for column in _inspector().get_columns(table_name)}


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return index_name in {index["name"] for index in _inspector().get_indexes(table_name)}


def _has_check_constraint(table_name: str, constraint_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return constraint_name in {
        constraint["name"] for constraint in _inspector().get_check_constraints(table_name)
    }


def _drop_index_once(table_name: str, index_name: str) -> None:
    if _has_index(table_name, index_name):
        op.drop_index(index_name, table_name=table_name)


def _create_index_once(
    table_name: str,
    index_name: str,
    columns: list[str],
    *,
    unique: bool = False,
) -> None:
    if not _has_index(table_name, index_name):
        op.create_index(index_name, table_name, columns, unique=unique)


def _drop_check_once(table_name: str, constraint_name: str) -> None:
    if _has_check_constraint(table_name, constraint_name):
        op.drop_constraint(constraint_name, table_name, type_="check")


def _create_check_once(table_name: str, constraint_name: str, condition: str) -> None:
    if not _has_check_constraint(table_name, constraint_name):
        op.create_check_constraint(constraint_name, table_name, condition)


def _agent_to_provider_case(column_name: str) -> str:
    return (
        f"CASE {column_name} "
        "WHEN 'claude' THEN 'anthropic' "
        "WHEN 'codex' THEN 'openai' "
        "WHEN 'opencode' THEN 'openai' "
        "WHEN 'gemini' THEN 'gemini' "
        "WHEN 'cursor' THEN 'cursor' "
        "ELSE 'openai' END"
    )


def _agent_to_slot_case(column_name: str) -> str:
    return (
        f"CASE {column_name} "
        "WHEN 'claude' THEN 'anthropic' "
        "WHEN 'codex' THEN 'openai' "
        "WHEN 'opencode' THEN 'openai' "
        "WHEN 'gemini' THEN 'gemini' "
        "WHEN 'cursor' THEN 'cursor' "
        "ELSE 'openai' END"
    )


def _provider_to_agent_case(column_name: str) -> str:
    return (
        f"CASE {column_name} "
        "WHEN 'anthropic' THEN 'claude' "
        "WHEN 'openai' THEN 'codex' "
        "WHEN 'gemini' THEN 'gemini' "
        "ELSE 'codex' END"
    )


def upgrade() -> None:
    _upgrade_credentials()
    _upgrade_shares()
    _upgrade_selections()
    _upgrade_runtime_grants()


def downgrade() -> None:
    _downgrade_runtime_grants()
    _downgrade_selections()
    _downgrade_shares()
    _downgrade_credentials()


def _upgrade_credentials() -> None:
    if not _has_table("agent_auth_credential"):
        return
    if not _has_column("agent_auth_credential", "credential_provider_id"):
        op.add_column(
            "agent_auth_credential",
            sa.Column("credential_provider_id", sa.String(length=64), nullable=True),
        )
    if _has_column("agent_auth_credential", "agent_kind"):
        op.execute(
            sa.text(
                f"""
                UPDATE agent_auth_credential
                SET credential_provider_id = {_agent_to_provider_case("agent_kind")}
                WHERE credential_provider_id IS NULL
                """
            )
        )
    op.execute(
        sa.text(
            """
            UPDATE agent_auth_credential
            SET credential_provider_id = 'openai'
            WHERE credential_provider_id IS NULL
            """
        )
    )
    op.alter_column("agent_auth_credential", "credential_provider_id", nullable=False)

    _drop_index_once("agent_auth_credential", "ix_agent_auth_credential_agent_kind")
    _drop_index_once("agent_auth_credential", "ix_agent_auth_credential_owner_user_kind_status")
    _drop_index_once("agent_auth_credential", "ix_agent_auth_credential_org_kind_status")
    _drop_check_once("agent_auth_credential", "ck_agent_auth_credential_agent_kind")
    _drop_check_once("agent_auth_credential", "ck_agent_auth_credential_provider")
    if _has_column("agent_auth_credential", "agent_kind"):
        op.drop_column("agent_auth_credential", "agent_kind")

    _create_check_once(
        "agent_auth_credential",
        "ck_agent_auth_credential_provider",
        _PROVIDER_CONSTRAINT,
    )
    _create_index_once(
        "agent_auth_credential",
        "ix_agent_auth_credential_credential_provider_id",
        ["credential_provider_id"],
    )
    _create_index_once(
        "agent_auth_credential",
        "ix_agent_auth_credential_owner_user_provider_status",
        ["owner_scope", "owner_user_id", "credential_provider_id", "status"],
    )
    _create_index_once(
        "agent_auth_credential",
        "ix_agent_auth_credential_org_provider_status",
        ["owner_scope", "organization_id", "credential_provider_id", "status"],
    )


def _upgrade_shares() -> None:
    if not _has_table("agent_auth_credential_share"):
        return
    if not _has_column("agent_auth_credential_share", "allowed_credential_provider_id"):
        op.add_column(
            "agent_auth_credential_share",
            sa.Column("allowed_credential_provider_id", sa.String(length=64), nullable=True),
        )
    if _has_column("agent_auth_credential_share", "allowed_agent_kind"):
        provider_expr = _agent_to_provider_case("allowed_agent_kind")
        op.execute(
            sa.text(
                f"""
                UPDATE agent_auth_credential_share
                SET allowed_credential_provider_id = {provider_expr}
                WHERE allowed_credential_provider_id IS NULL
                """
            )
        )
    op.execute(
        sa.text(
            """
            UPDATE agent_auth_credential_share
            SET allowed_credential_provider_id = 'openai'
            WHERE allowed_credential_provider_id IS NULL
            """
        )
    )
    op.alter_column(
        "agent_auth_credential_share",
        "allowed_credential_provider_id",
        nullable=False,
    )

    _drop_index_once("agent_auth_credential_share", "ix_agent_auth_share_org_kind_status")
    _drop_check_once(
        "agent_auth_credential_share",
        "ck_agent_auth_credential_share_agent_kind",
    )
    _drop_check_once(
        "agent_auth_credential_share",
        "ck_agent_auth_credential_share_provider",
    )
    if _has_column("agent_auth_credential_share", "allowed_agent_kind"):
        op.drop_column("agent_auth_credential_share", "allowed_agent_kind")

    _create_check_once(
        "agent_auth_credential_share",
        "ck_agent_auth_credential_share_provider",
        _SHARE_PROVIDER_CONSTRAINT,
    )
    _create_index_once(
        "agent_auth_credential_share",
        "ix_agent_auth_credential_share_allowed_credential_provider_id",
        ["allowed_credential_provider_id"],
    )
    _create_index_once(
        "agent_auth_credential_share",
        "ix_agent_auth_share_org_provider_status",
        ["organization_id", "allowed_credential_provider_id", "status"],
    )


def _upgrade_selections() -> None:
    if not _has_table("sandbox_agent_auth_selection"):
        return
    if not _has_column("sandbox_agent_auth_selection", "auth_slot_id"):
        op.add_column(
            "sandbox_agent_auth_selection",
            sa.Column("auth_slot_id", sa.String(length=64), nullable=True),
        )
    op.execute(
        sa.text(
            f"""
            UPDATE sandbox_agent_auth_selection
            SET auth_slot_id = {_agent_to_slot_case("agent_kind")}
            WHERE auth_slot_id IS NULL
            """
        )
    )
    op.alter_column("sandbox_agent_auth_selection", "auth_slot_id", nullable=False)
    _drop_index_once(
        "sandbox_agent_auth_selection",
        "uq_sandbox_agent_auth_selection_profile_agent",
    )
    _create_index_once(
        "sandbox_agent_auth_selection",
        "ix_sandbox_agent_auth_selection_auth_slot_id",
        ["auth_slot_id"],
    )
    _create_index_once(
        "sandbox_agent_auth_selection",
        "uq_sandbox_agent_auth_selection_profile_agent_slot",
        ["sandbox_profile_id", "agent_kind", "auth_slot_id"],
        unique=True,
    )


def _upgrade_runtime_grants() -> None:
    if not _has_table("agent_gateway_runtime_grant"):
        return
    if not _has_column("agent_gateway_runtime_grant", "auth_slot_id"):
        op.add_column(
            "agent_gateway_runtime_grant",
            sa.Column("auth_slot_id", sa.String(length=64), nullable=True),
        )
    if _has_table("sandbox_agent_auth_selection") and _has_column(
        "sandbox_agent_auth_selection",
        "auth_slot_id",
    ):
        op.execute(
            sa.text(
                """
                UPDATE agent_gateway_runtime_grant AS runtime_grant
                SET auth_slot_id = selection.auth_slot_id
                FROM sandbox_agent_auth_selection AS selection
                WHERE runtime_grant.selection_id = selection.id
                  AND runtime_grant.auth_slot_id IS NULL
                """
            )
        )
    op.execute(
        sa.text(
            f"""
            UPDATE agent_gateway_runtime_grant
            SET auth_slot_id = {_agent_to_slot_case("agent_kind")}
            WHERE auth_slot_id IS NULL
            """
        )
    )
    op.alter_column("agent_gateway_runtime_grant", "auth_slot_id", nullable=False)
    _drop_index_once(
        "agent_gateway_runtime_grant",
        "ix_agent_gateway_runtime_grant_target_profile_agent",
    )
    _create_index_once(
        "agent_gateway_runtime_grant",
        "ix_agent_gateway_runtime_grant_auth_slot_id",
        ["auth_slot_id"],
    )
    _create_index_once(
        "agent_gateway_runtime_grant",
        "ix_agent_gateway_runtime_grant_target_profile_agent",
        ["target_id", "sandbox_profile_id", "agent_kind", "auth_slot_id"],
    )


def _downgrade_credentials() -> None:
    if not _has_table("agent_auth_credential"):
        return
    if not _has_column("agent_auth_credential", "agent_kind"):
        op.add_column(
            "agent_auth_credential",
            sa.Column("agent_kind", sa.String(length=32), nullable=True),
        )
    if _has_column("agent_auth_credential", "credential_provider_id"):
        op.execute(
            sa.text(
                f"""
                UPDATE agent_auth_credential
                SET agent_kind = {_provider_to_agent_case("credential_provider_id")}
                WHERE agent_kind IS NULL
                """
            )
        )
    op.alter_column("agent_auth_credential", "agent_kind", nullable=False)

    _drop_index_once("agent_auth_credential", "ix_agent_auth_credential_credential_provider_id")
    _drop_index_once(
        "agent_auth_credential",
        "ix_agent_auth_credential_owner_user_provider_status",
    )
    _drop_index_once("agent_auth_credential", "ix_agent_auth_credential_org_provider_status")
    _drop_check_once("agent_auth_credential", "ck_agent_auth_credential_provider")
    if _has_column("agent_auth_credential", "credential_provider_id"):
        op.drop_column("agent_auth_credential", "credential_provider_id")

    _create_check_once(
        "agent_auth_credential",
        "ck_agent_auth_credential_agent_kind",
        _AGENT_KIND_CONSTRAINT,
    )
    _create_index_once(
        "agent_auth_credential",
        "ix_agent_auth_credential_agent_kind",
        ["agent_kind"],
    )
    _create_index_once(
        "agent_auth_credential",
        "ix_agent_auth_credential_owner_user_kind_status",
        ["owner_scope", "owner_user_id", "agent_kind", "status"],
    )
    _create_index_once(
        "agent_auth_credential",
        "ix_agent_auth_credential_org_kind_status",
        ["owner_scope", "organization_id", "agent_kind", "status"],
    )


def _downgrade_shares() -> None:
    if not _has_table("agent_auth_credential_share"):
        return
    if not _has_column("agent_auth_credential_share", "allowed_agent_kind"):
        op.add_column(
            "agent_auth_credential_share",
            sa.Column("allowed_agent_kind", sa.String(length=32), nullable=True),
        )
    if _has_column("agent_auth_credential_share", "allowed_credential_provider_id"):
        agent_expr = _provider_to_agent_case("allowed_credential_provider_id")
        op.execute(
            sa.text(
                f"""
                UPDATE agent_auth_credential_share
                SET allowed_agent_kind = {agent_expr}
                WHERE allowed_agent_kind IS NULL
                """
            )
        )
    op.alter_column("agent_auth_credential_share", "allowed_agent_kind", nullable=False)

    _drop_index_once(
        "agent_auth_credential_share",
        "ix_agent_auth_credential_share_allowed_credential_provider_id",
    )
    _drop_index_once("agent_auth_credential_share", "ix_agent_auth_share_org_provider_status")
    _drop_check_once(
        "agent_auth_credential_share",
        "ck_agent_auth_credential_share_provider",
    )
    if _has_column("agent_auth_credential_share", "allowed_credential_provider_id"):
        op.drop_column("agent_auth_credential_share", "allowed_credential_provider_id")

    _create_check_once(
        "agent_auth_credential_share",
        "ck_agent_auth_credential_share_agent_kind",
        "allowed_agent_kind IN ('claude', 'codex', 'opencode', 'gemini')",
    )
    _create_index_once(
        "agent_auth_credential_share",
        "ix_agent_auth_share_org_kind_status",
        ["organization_id", "allowed_agent_kind", "status"],
    )


def _downgrade_selections() -> None:
    if not _has_table("sandbox_agent_auth_selection"):
        return
    _drop_index_once(
        "sandbox_agent_auth_selection",
        "uq_sandbox_agent_auth_selection_profile_agent_slot",
    )
    _drop_index_once(
        "sandbox_agent_auth_selection",
        "ix_sandbox_agent_auth_selection_auth_slot_id",
    )
    if _has_column("sandbox_agent_auth_selection", "auth_slot_id"):
        _collapse_selection_slots_for_legacy_unique_index()
        op.drop_column("sandbox_agent_auth_selection", "auth_slot_id")
    _create_index_once(
        "sandbox_agent_auth_selection",
        "uq_sandbox_agent_auth_selection_profile_agent",
        ["sandbox_profile_id", "agent_kind"],
        unique=True,
    )


def _collapse_selection_slots_for_legacy_unique_index() -> None:
    op.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT
                    id,
                    row_number() OVER (
                        PARTITION BY sandbox_profile_id, agent_kind
                        ORDER BY
                            CASE
                                WHEN auth_slot_id = CASE agent_kind
                                    WHEN 'claude' THEN 'anthropic'
                                    WHEN 'codex' THEN 'openai'
                                    WHEN 'opencode' THEN 'openai'
                                    WHEN 'gemini' THEN 'gemini'
                                    WHEN 'cursor' THEN 'cursor'
                                    ELSE 'openai'
                                END THEN 0
                                ELSE 1
                            END,
                            updated_at DESC,
                            created_at DESC,
                            id ASC
                    ) AS duplicate_rank
                FROM sandbox_agent_auth_selection
            )
            DELETE FROM sandbox_agent_auth_selection
            WHERE id IN (
                SELECT id
                FROM ranked
                WHERE duplicate_rank > 1
            )
            """
        )
    )


def _downgrade_runtime_grants() -> None:
    if not _has_table("agent_gateway_runtime_grant"):
        return
    _drop_index_once(
        "agent_gateway_runtime_grant",
        "ix_agent_gateway_runtime_grant_target_profile_agent",
    )
    _drop_index_once("agent_gateway_runtime_grant", "ix_agent_gateway_runtime_grant_auth_slot_id")
    if _has_column("agent_gateway_runtime_grant", "auth_slot_id"):
        op.drop_column("agent_gateway_runtime_grant", "auth_slot_id")
    _create_index_once(
        "agent_gateway_runtime_grant",
        "ix_agent_gateway_runtime_grant_target_profile_agent",
        ["target_id", "sandbox_profile_id", "agent_kind"],
    )
