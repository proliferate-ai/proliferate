"""cloud commands close session

Revision ID: c7d8e9f0a1b2
Revises: c6d7e8f9a0b1
Create Date: 2026-05-13 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c7d8e9f0a1b2"
down_revision: str | Sequence[str] | None = "c6d7e8f9a0b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW_KIND_CHECK = (
    "kind IN ('start_session', 'resume_session', 'send_prompt', "
    "'resolve_interaction', 'update_session_config', 'cancel_turn', "
    "'close_session', 'cancel_session', 'stop_workspace', 'hibernate_workspace', "
    "'resume_workspace', 'prune_workspace', 'extend_workspace_ttl', "
    "'backfill_exposed_workspace')"
)

OLD_KIND_CHECK = (
    "kind IN ('start_session', 'resume_session', 'send_prompt', "
    "'resolve_interaction', 'update_session_config', 'cancel_turn', "
    "'cancel_session', 'stop_workspace', 'hibernate_workspace', "
    "'resume_workspace', 'prune_workspace', 'extend_workspace_ttl', "
    "'backfill_exposed_workspace')"
)


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_constraint("ck_cloud_commands_kind", "cloud_commands", type_="check")
    op.create_check_constraint("ck_cloud_commands_kind", "cloud_commands", NEW_KIND_CHECK)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("ck_cloud_commands_kind", "cloud_commands", type_="check")
    op.create_check_constraint("ck_cloud_commands_kind", "cloud_commands", OLD_KIND_CHECK)
