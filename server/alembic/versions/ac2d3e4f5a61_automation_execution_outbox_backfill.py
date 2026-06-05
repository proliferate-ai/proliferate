"""automation execution outbox backfill

Revision ID: ac2d3e4f5a61
Revises: ab1c2d3e4f60
Create Date: 2026-06-05 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "ac2d3e4f5a61"
down_revision: str | Sequence[str] | None = "ab1c2d3e4f60"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            INSERT INTO background_outbox_task (
                id,
                task_name,
                queue,
                args_json,
                kwargs_json,
                idempotency_key,
                status,
                available_at,
                attempt_count,
                created_at,
                updated_at
            )
            SELECT
                gen_random_uuid(),
                'automations.execute_run',
                'automations.execution',
                '[]'::jsonb,
                jsonb_build_object('run_id', automation_run.id::text),
                'automations.execute_run:' || automation_run.id::text,
                'pending',
                now(),
                0,
                now(),
                now()
            FROM automation_run
            WHERE automation_run.target_mode IN ('personal_cloud', 'shared_cloud')
              AND (
                automation_run.status = 'queued'
                OR (
                  automation_run.status IN (
                    'claimed',
                    'creating_workspace',
                    'provisioning_workspace',
                    'creating_session'
                  )
                  AND automation_run.claim_expires_at IS NOT NULL
                  AND automation_run.claim_expires_at <= now()
                )
              )
            ON CONFLICT (idempotency_key)
              WHERE idempotency_key IS NOT NULL
              DO NOTHING
            """
        )
    )


def downgrade() -> None:
    # Data-only cutover migration. Leave outbox rows in place on downgrade so
    # already-queued automation work is not silently dropped.
    pass
