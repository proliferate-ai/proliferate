"""Drop parked cloud domain tables.

Removes the tables behind the parked legacy cloud domains deleted in the
dead-code sweep: MCP connections/catalog/OAuth, org integration policy,
skills, plugins, Slack bot, and workspace mobility. These domains are being
rebuilt on the integration-gateway model; no data is preserved.

Revision ID: f8b9c0d1e2f4
Revises: e7a8b9c0d1e3
Create Date: 2026-07-01 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "f8b9c0d1e2f4"
down_revision: str | None = "e7a8b9c0d1e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DROPPED_TABLES = (
    "cloud_mcp_connection_auth",
    "cloud_mcp_oauth_flow",
    "cloud_mcp_oauth_client",
    "cloud_mcp_connection",
    "cloud_mcp_connection_event",
    "cloud_organization_integration_policy",
    "cloud_skill_configured_item",
    "cloud_plugin_configured_item",
    "cloud_repo_routing_profile",
    "slack_outbound_message_queue",
    "slack_inbound_event_job",
    "slack_event_envelope_seen",
    "slack_thread_work",
    "slack_bot_config",
    "slack_workspace_connection",
    "cloud_workspace_move_cleanup_item",
    "cloud_workspace_handoff_op",
    "cloud_workspace_mobility",
    "cloud_workspace_mobility_event",
)


def upgrade() -> None:
    for table in DROPPED_TABLES:
        op.execute(f'DROP TABLE IF EXISTS "{table}" CASCADE')


def downgrade() -> None:
    raise NotImplementedError("Parked cloud domain tables are gone for good.")
