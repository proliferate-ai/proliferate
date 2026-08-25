"""Drop retained automation tables and the Customer.io welcome column.

The automation lane (schedule-driven agent runs) was superseded by gen-2
workflows; its API surface is already gone and the client stack is removed in
the same change. No data is preserved.

Column vocabulary retained here as starting material for the trigger system
that replaces automations:

- ``automation``: owner_scope ∈ (personal, organization) with owner_user_id /
  organization_id exclusivity; target_mode ∈ (local, personal_cloud,
  shared_cloud) constrained by owner_scope; schedule_rrule + schedule_timezone
  (IANA) + schedule_summary; enabled / paused_at; next_run_at +
  last_scheduled_at with a partial index on (next_run_at) WHERE enabled AND
  next_run_at IS NOT NULL as the scheduler-due scan; prompt + title;
  repo_environment_id (RESTRICT) and cloud_agent_run_config_id (RESTRICT) as
  frozen target bindings.
- ``automation_run``: trigger_kind ∈ (scheduled, manual) with scheduled_for
  exactly-when-scheduled; a unique (automation_id, scheduled_for) slot index
  WHERE trigger_kind = 'scheduled' for invocation dedup; status ladder queued →
  claimed → creating_workspace → provisioning_workspace → creating_session →
  dispatching → dispatched | failed | cancelled; claim_id / claimed_at /
  claim_expires_at / last_heartbeat_at lease fields with partial claimable and
  claim-expiry indexes per target class; *_snapshot columns freezing title,
  prompt, git coordinates, repo environment, and agent run config at
  invocation time; cascade_attempt / last_cascade_* retry provenance;
  executor_kind / executor_id; last_error_code / last_error_message.

``user.customerio_welcome_sent_at`` goes with the Customer.io vertical.

Downgrade is intentionally unsupported, matching the cull precedent
(f8b9c0d1e2f4): these tables are gone for good.

Revision ID: cd15ae907558
Revises: d7e8f9a0b1c2
Create Date: 2026-08-25 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "cd15ae907558"
down_revision: str | None = "d7e8f9a0b1c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DROPPED_TABLES = (
    "automation_run",
    "automation",
)


def upgrade() -> None:
    for table in DROPPED_TABLES:
        op.execute(f'DROP TABLE IF EXISTS "{table}" CASCADE')
    op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS customerio_welcome_sent_at')


def downgrade() -> None:
    raise NotImplementedError("Automation tables are gone for good.")
