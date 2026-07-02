"""drop agent auth gateway tables

Removes the Bifrost-era agent-auth and agent-gateway schema. The gateway is
being replaced by LiteLLM (see specs/codebase/primitives/agent-auth-litellm.md);
PR 1 drops the shipped stack outright. `free_cloud_allocation` is intentionally
kept so historical free-credit dedup survives.

Revision ID: f8b9c0d1e2a3
Revises: d7f3a91c4b2e
Create Date: 2026-07-01 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f8b9c0d1e2a3"
down_revision: str | Sequence[str] | None = "d7f3a91c4b2e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Ordered children-before-parents so plain DROP TABLE respects foreign keys.
_AGENT_AUTH_TABLES: tuple[str, ...] = (
    "agent_gateway_llm_usage_event",
    "agent_gateway_router_materialization",
    "agent_gateway_usage_import_cursor",
    "agent_gateway_runtime_grant",
    "agent_gateway_free_credit_entitlement",
    "agent_gateway_provider_credential",
    "agent_gateway_policy",
    "agent_gateway_budget_subject",
    "agent_auth_audit_event",
    "sandbox_agent_auth_selection",
    "agent_auth_credential_share",
    "agent_auth_credential",
    # Bifrost-era sandbox-profile tables; already dropped by
    # d4e6f8a0b2c4 on fresh databases but kept here so any environment that
    # skipped that path converges.
    "sandbox_profile_agent_auth_target_state",
    "sandbox_profile_agent_auth_revision",
    "sandbox_profile_target_state",
    "sandbox_profile",
)


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def upgrade() -> None:
    for table_name in _AGENT_AUTH_TABLES:
        if _has_table(table_name):
            op.drop_table(table_name)


def downgrade() -> None:
    # Full reset by design: the Bifrost-era schema is not recreated.
    pass
