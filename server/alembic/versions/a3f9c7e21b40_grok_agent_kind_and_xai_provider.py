"""grok agent kind and xai credential provider

Widens the cloud agent CHECK constraints to admit the 'grok' agent kind and the
'xai' credential provider. Grok is a full cloud agent (in SUPPORTED_CLOUD_AGENTS)
authenticated BYO-key via the synced ~/.grok/auth.json credential under provider
'xai' — it is NOT a managed-gateway agent. This mirrors how cursor (provider) and
gemini (agent) were registered. Purely additive/permissive: no rows change, only
the set of permitted values grows, so it is safe and reversible.

Revision ID: a3f9c7e21b40
Revises: b0c1d2e3f4a6
Create Date: 2026-06-16 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a3f9c7e21b40"
down_revision: str | Sequence[str] | None = "b0c1d2e3f4a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# agent_kind sets — the two run-config tables also admit the catalog-only kind
# 'cursor'; the launchable set (selection + runtime grant) does not.
_KIND_WITH_CURSOR_OLD = "agent_kind IN ('claude', 'codex', 'opencode', 'gemini', 'cursor')"
_KIND_WITH_CURSOR_NEW = "agent_kind IN ('claude', 'codex', 'opencode', 'gemini', 'cursor', 'grok')"
_KIND_CLOUD_OLD = "agent_kind IN ('claude', 'codex', 'opencode', 'gemini')"
_KIND_CLOUD_NEW = "agent_kind IN ('claude', 'codex', 'opencode', 'gemini', 'grok')"
# credential_provider sets
_PROVIDER_OLD = "credential_provider_id IN ('anthropic', 'openai', 'gemini', 'cursor')"
_PROVIDER_NEW = "credential_provider_id IN ('anthropic', 'openai', 'gemini', 'cursor', 'xai')"
_SHARE_OLD = "allowed_credential_provider_id IN ('anthropic', 'openai', 'gemini', 'cursor')"
_SHARE_NEW = "allowed_credential_provider_id IN ('anthropic', 'openai', 'gemini', 'cursor', 'xai')"

# (table, constraint_name, old_condition, new_condition)
_CHECKS: tuple[tuple[str, str, str, str], ...] = (
    (
        "cloud_agent_run_config",
        "ck_cloud_agent_run_config_agent_kind",
        _KIND_WITH_CURSOR_OLD,
        _KIND_WITH_CURSOR_NEW,
    ),
    (
        "cloud_agent_run_config_default",
        "ck_cloud_agent_run_config_default_agent_kind",
        _KIND_WITH_CURSOR_OLD,
        _KIND_WITH_CURSOR_NEW,
    ),
    (
        "sandbox_agent_auth_selection",
        "ck_sandbox_agent_auth_selection_agent_kind",
        _KIND_CLOUD_OLD,
        _KIND_CLOUD_NEW,
    ),
    (
        "agent_gateway_runtime_grant",
        "ck_agent_gateway_runtime_grant_agent_kind",
        _KIND_CLOUD_OLD,
        _KIND_CLOUD_NEW,
    ),
    (
        "agent_auth_credential",
        "ck_agent_auth_credential_provider",
        _PROVIDER_OLD,
        _PROVIDER_NEW,
    ),
    (
        "agent_auth_credential_share",
        "ck_agent_auth_credential_share_provider",
        _SHARE_OLD,
        _SHARE_NEW,
    ),
)


def _inspector() -> sa.engine.reflection.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _has_check_constraint(table_name: str, constraint_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return constraint_name in {
        constraint["name"] for constraint in _inspector().get_check_constraints(table_name)
    }


def _drop_check_once(table_name: str, constraint_name: str) -> None:
    if _has_check_constraint(table_name, constraint_name):
        op.drop_constraint(constraint_name, table_name, type_="check")


def _create_check_once(table_name: str, constraint_name: str, condition: str) -> None:
    if not _has_check_constraint(table_name, constraint_name):
        op.create_check_constraint(constraint_name, table_name, condition)


def upgrade() -> None:
    for table_name, constraint_name, _old, new in _CHECKS:
        _drop_check_once(table_name, constraint_name)
        _create_check_once(table_name, constraint_name, new)


def downgrade() -> None:
    for table_name, constraint_name, old, _new in _CHECKS:
        _drop_check_once(table_name, constraint_name)
        _create_check_once(table_name, constraint_name, old)
