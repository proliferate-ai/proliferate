"""canonicalize agent run config model aliases

Revision ID: 5e6f708192a3
Revises: 4d5e6f708192
Create Date: 2026-05-31 16:45:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "5e6f708192a3"
down_revision: str | Sequence[str] | None = "4d5e6f708192"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)
    }


def upgrade() -> None:
    if _has_table("cloud_agent_run_config") and all(
        _has_column("cloud_agent_run_config", column_name)
        for column_name in ("agent_kind", "model_id", "updated_at")
    ):
        op.execute(
            sa.text(
                """
                WITH alias_map(agent_kind, legacy_model_id, canonical_model_id) AS (
                  VALUES
                    ('cursor', 'default[]', 'auto'),
                    ('cursor', 'composer-2[fast=true]', 'composer-2.5-fast'),
                    ('cursor', 'composer-2-fast', 'composer-2.5-fast'),
                    ('cursor', 'composer-1.5[]', 'composer-2.5'),
                    ('cursor', 'composer-2', 'composer-2.5'),
                    (
                      'cursor',
                      'gpt-5.3-codex[reasoning=medium,fast=false]',
                      'gpt-5.3-codex'
                    ),
                    (
                      'cursor',
                      'gpt-5.3-codex-spark[reasoning=medium]',
                      'gpt-5.3-codex'
                    ),
                    (
                      'cursor',
                      'gpt-5.3-codex-spark-preview-low',
                      'gpt-5.3-codex-low'
                    ),
                    (
                      'cursor',
                      'gpt-5.3-codex-spark-preview',
                      'gpt-5.3-codex'
                    ),
                    (
                      'cursor',
                      'gpt-5.3-codex-spark-preview-high',
                      'gpt-5.3-codex-high'
                    ),
                    (
                      'cursor',
                      'gpt-5.3-codex-spark-preview-xhigh',
                      'gpt-5.3-codex-xhigh'
                    ),
                    (
                      'cursor',
                      'claude-sonnet-4-6[thinking=true,context=200k,effort=medium]',
                      'claude-4.6-sonnet-medium'
                    ),
                    (
                      'cursor',
                      'claude-opus-4-7[thinking=true,context=300k,effort=xhigh]',
                      'claude-opus-4-7-xhigh'
                    )
                )
                UPDATE cloud_agent_run_config AS config
                SET
                  model_id = alias_map.canonical_model_id,
                  updated_at = now()
                FROM alias_map
                WHERE config.agent_kind = alias_map.agent_kind
                  AND config.model_id = alias_map.legacy_model_id
                """
            )
        )

    if _has_table("automation_run") and _has_column(
        "automation_run",
        "agent_run_config_snapshot_json",
    ):
        op.execute(
            sa.text(
                """
                WITH alias_map(agent_kind, legacy_model_id, canonical_model_id) AS (
                  VALUES
                    ('cursor', 'default[]', 'auto'),
                    ('cursor', 'composer-2[fast=true]', 'composer-2.5-fast'),
                    ('cursor', 'composer-2-fast', 'composer-2.5-fast'),
                    ('cursor', 'composer-1.5[]', 'composer-2.5'),
                    ('cursor', 'composer-2', 'composer-2.5'),
                    (
                      'cursor',
                      'gpt-5.3-codex[reasoning=medium,fast=false]',
                      'gpt-5.3-codex'
                    ),
                    (
                      'cursor',
                      'gpt-5.3-codex-spark[reasoning=medium]',
                      'gpt-5.3-codex'
                    ),
                    (
                      'cursor',
                      'gpt-5.3-codex-spark-preview-low',
                      'gpt-5.3-codex-low'
                    ),
                    (
                      'cursor',
                      'gpt-5.3-codex-spark-preview',
                      'gpt-5.3-codex'
                    ),
                    (
                      'cursor',
                      'gpt-5.3-codex-spark-preview-high',
                      'gpt-5.3-codex-high'
                    ),
                    (
                      'cursor',
                      'gpt-5.3-codex-spark-preview-xhigh',
                      'gpt-5.3-codex-xhigh'
                    ),
                    (
                      'cursor',
                      'claude-sonnet-4-6[thinking=true,context=200k,effort=medium]',
                      'claude-4.6-sonnet-medium'
                    ),
                    (
                      'cursor',
                      'claude-opus-4-7[thinking=true,context=300k,effort=xhigh]',
                      'claude-opus-4-7-xhigh'
                    )
                )
                UPDATE automation_run AS run
                SET agent_run_config_snapshot_json = jsonb_set(
                  run.agent_run_config_snapshot_json,
                  '{model_id}',
                  to_jsonb(alias_map.canonical_model_id),
                  false
                )
                FROM alias_map
                WHERE run.agent_run_config_snapshot_json IS NOT NULL
                  AND run.agent_run_config_snapshot_json->>'agent_kind' = alias_map.agent_kind
                  AND run.agent_run_config_snapshot_json->>'model_id' = alias_map.legacy_model_id
                """
            )
        )


def downgrade() -> None:
    """Leave canonicalized model ids in place."""
