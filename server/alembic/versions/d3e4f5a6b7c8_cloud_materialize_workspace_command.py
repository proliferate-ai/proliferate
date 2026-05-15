"""cloud materialize workspace command

Revision ID: d3e4f5a6b7c8
Revises: d2e3f4a5b6c7
Create Date: 2026-05-14 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d3e4f5a6b7c8"
down_revision: str | Sequence[str] | None = "d2e3f4a5b6c7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_COMMAND_KINDS = (
    "start_session",
    "materialize_environment",
    "resume_session",
    "send_prompt",
    "resolve_interaction",
    "update_session_config",
    "cancel_turn",
    "close_session",
    "cancel_session",
    "stop_workspace",
    "hibernate_workspace",
    "resume_workspace",
    "prune_workspace",
    "extend_workspace_ttl",
    "sync_existing_workspace",
)

_NEW_COMMAND_KINDS = (
    "start_session",
    "materialize_workspace",
    "materialize_environment",
    "resume_session",
    "send_prompt",
    "resolve_interaction",
    "update_session_config",
    "cancel_turn",
    "close_session",
    "cancel_session",
    "stop_workspace",
    "hibernate_workspace",
    "resume_workspace",
    "prune_workspace",
    "extend_workspace_ttl",
    "sync_existing_workspace",
)


def _in_constraint(column_name: str, values: tuple[str, ...]) -> str:
    return f"{column_name} IN {values}"


def _has_check_constraint(table_name: str, constraint_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return constraint_name in {
        constraint["name"] for constraint in inspector.get_check_constraints(table_name)
    }


def _replace_command_kind_constraint(values: tuple[str, ...]) -> None:
    if _has_check_constraint("cloud_commands", "ck_cloud_commands_kind"):
        op.drop_constraint("ck_cloud_commands_kind", "cloud_commands", type_="check")
    op.create_check_constraint(
        "ck_cloud_commands_kind",
        "cloud_commands",
        _in_constraint("kind", values),
    )


def upgrade() -> None:
    """Upgrade schema."""
    _replace_command_kind_constraint(_NEW_COMMAND_KINDS)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM cloud_commands WHERE kind = 'materialize_workspace'")
    _replace_command_kind_constraint(_OLD_COMMAND_KINDS)
