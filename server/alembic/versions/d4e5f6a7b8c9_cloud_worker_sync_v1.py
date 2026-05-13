"""cloud worker sync v1

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-05-13 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4e5f6a7b8c9"
down_revision: str | Sequence[str] | None = "c3d4e5f6a7b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSONB = postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "cloud_targets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("org_id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=True),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("access_scope", sa.String(length=32), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("default_workspace_root", sa.Text(), nullable=True),
        sa.Column("persistence_class", sa.String(length=32), nullable=False),
        sa.Column("direct_attach_policy", sa.String(length=32), nullable=False),
        sa.Column("cloud_sync_enabled", sa.Boolean(), nullable=False),
        sa.Column("update_channel", sa.String(length=32), nullable=False),
        sa.Column("desired_anyharness_version", sa.String(length=128), nullable=True),
        sa.Column("desired_worker_version", sa.String(length=128), nullable=True),
        sa.Column("desired_supervisor_version", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "kind IN ('managed_cloud', 'self_hosted_cloud', 'ssh', "
            "'desktop_dispatch', 'local_direct', 'future_vpc_worker')",
            name="ck_cloud_targets_kind",
        ),
        sa.CheckConstraint(
            "access_scope IN ('personal', 'team', 'org')",
            name="ck_cloud_targets_access_scope",
        ),
        sa.CheckConstraint(
            "persistence_class IN ('ephemeral', 'persistent', 'snapshot_backed', 'unknown')",
            name="ck_cloud_targets_persistence_class",
        ),
        sa.CheckConstraint(
            "direct_attach_policy IN ('disabled', 'owner_only', 'team_grant', 'org_grant')",
            name="ck_cloud_targets_direct_attach_policy",
        ),
        sa.CheckConstraint(
            "update_channel IN ('stable', 'beta', 'pinned')",
            name="ck_cloud_targets_update_channel",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cloud_targets_org_id", "cloud_targets", ["org_id"])
    op.create_index("ix_cloud_targets_owner_user_id", "cloud_targets", ["owner_user_id"])
    op.create_index(
        "ix_cloud_targets_created_by_user_id",
        "cloud_targets",
        ["created_by_user_id"],
    )
    op.create_index(
        "ix_cloud_targets_org_kind_archived",
        "cloud_targets",
        ["org_id", "kind", "archived_at"],
    )

    op.create_table(
        "cloud_target_enrollments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=True),
        sa.Column("org_id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("access_scope", sa.String(length=32), nullable=False),
        sa.Column("default_workspace_root", sa.Text(), nullable=True),
        sa.Column("persistence_class", sa.String(length=32), nullable=False),
        sa.Column("direct_attach_policy", sa.String(length=32), nullable=False),
        sa.Column("cloud_sync_enabled", sa.Boolean(), nullable=False),
        sa.Column("update_channel", sa.String(length=32), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "kind IN ('managed_cloud', 'self_hosted_cloud', 'ssh', "
            "'desktop_dispatch', 'local_direct', 'future_vpc_worker')",
            name="ck_cloud_target_enrollments_kind",
        ),
        sa.CheckConstraint(
            "access_scope IN ('personal', 'team', 'org')",
            name="ck_cloud_target_enrollments_access_scope",
        ),
        sa.CheckConstraint(
            "persistence_class IN ('ephemeral', 'persistent', 'snapshot_backed', 'unknown')",
            name="ck_cloud_target_enrollments_persistence_class",
        ),
        sa.CheckConstraint(
            "direct_attach_policy IN ('disabled', 'owner_only', 'team_grant', 'org_grant')",
            name="ck_cloud_target_enrollments_direct_attach_policy",
        ),
        sa.CheckConstraint(
            "update_channel IN ('stable', 'beta', 'pinned')",
            name="ck_cloud_target_enrollments_update_channel",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_cloud_target_enrollments_token_hash",
        "cloud_target_enrollments",
        ["token_hash"],
        unique=True,
    )
    op.create_index(
        "ix_cloud_target_enrollments_org_expires",
        "cloud_target_enrollments",
        ["org_id", "expires_at"],
    )
    op.create_index("ix_cloud_target_enrollments_org_id", "cloud_target_enrollments", ["org_id"])
    op.create_index(
        "ix_cloud_target_enrollments_owner_user_id",
        "cloud_target_enrollments",
        ["owner_user_id"],
    )
    op.create_index(
        "ix_cloud_target_enrollments_created_by_user_id",
        "cloud_target_enrollments",
        ["created_by_user_id"],
    )

    op.create_table(
        "cloud_workers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("org_id", sa.Uuid(), nullable=False),
        sa.Column("install_id", sa.String(length=255), nullable=False),
        sa.Column("credential_hash", sa.String(length=64), nullable=False),
        sa.Column("public_key_fingerprint", sa.String(length=255), nullable=True),
        sa.Column("auth_version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_heartbeat_id", sa.String(length=255), nullable=True),
        sa.Column("worker_version", sa.String(length=128), nullable=True),
        sa.Column("supervisor_version", sa.String(length=128), nullable=True),
        sa.Column("anyharness_endpoint_kind", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "status IN ('enrolling', 'active', 'revoked', 'rotated')",
            name="ck_cloud_workers_status",
        ),
        sa.CheckConstraint(
            "anyharness_endpoint_kind IN ('http', 'unix_socket')",
            name="ck_cloud_workers_anyharness_endpoint_kind",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("install_id", name="uq_cloud_workers_install_id"),
    )
    op.create_index("ix_cloud_workers_target_id", "cloud_workers", ["target_id"])
    op.create_index("ix_cloud_workers_org_id", "cloud_workers", ["org_id"])
    op.create_index("ix_cloud_workers_target_status", "cloud_workers", ["target_id", "status"])
    op.create_index("ix_cloud_workers_last_seen", "cloud_workers", ["last_seen_at"])

    op.create_table(
        "cloud_target_status",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("org_id", sa.Uuid(), nullable=False),
        sa.Column("online_status", sa.String(length=32), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_inventory_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("worker_connected", sa.Boolean(), nullable=False),
        sa.Column("anyharness_reachable", sa.Boolean(), nullable=False),
        sa.Column("anyharness_version", sa.String(length=128), nullable=True),
        sa.Column("worker_version", sa.String(length=128), nullable=True),
        sa.Column("supervisor_version", sa.String(length=128), nullable=True),
        sa.Column("safe_stop_state", sa.String(length=32), nullable=False),
        sa.Column("safe_stop_reasons", JSONB, server_default=sa.text("'{}'::jsonb")),
        sa.Column("active_session_count", sa.Integer(), nullable=False),
        sa.Column("active_turn_count", sa.Integer(), nullable=False),
        sa.Column("pending_interaction_count", sa.Integer(), nullable=False),
        sa.Column("active_terminal_count", sa.Integer(), nullable=False),
        sa.Column("active_process_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "online_status IN ('online', 'degraded', 'offline')",
            name="ck_cloud_target_status_online_status",
        ),
        sa.CheckConstraint(
            "safe_stop_state IN ('safe', 'blocked', 'unknown')",
            name="ck_cloud_target_status_safe_stop_state",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("target_id", name="uq_cloud_target_status_target_id"),
    )
    op.create_index("ix_cloud_target_status_target_id", "cloud_target_status", ["target_id"])
    op.create_index("ix_cloud_target_status_org_id", "cloud_target_status", ["org_id"])

    op.create_table(
        "cloud_target_inventory",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("org_id", sa.Uuid(), nullable=False),
        sa.Column("os_kind", sa.String(length=64), nullable=True),
        sa.Column("os_version", sa.String(length=128), nullable=True),
        sa.Column("arch", sa.String(length=64), nullable=True),
        sa.Column("distro", sa.String(length=128), nullable=True),
        sa.Column("shell", sa.String(length=255), nullable=True),
        sa.Column("package_managers", JSONB, server_default=sa.text("'{}'::jsonb")),
        sa.Column("workspace_roots", JSONB, server_default=sa.text("'{}'::jsonb")),
        sa.Column("supports_process_spawn", sa.Boolean(), nullable=False),
        sa.Column("supports_pty", sa.Boolean(), nullable=False),
        sa.Column("supports_filesystem", sa.Boolean(), nullable=False),
        sa.Column("supports_git", sa.Boolean(), nullable=False),
        sa.Column("supports_network_egress", sa.Boolean(), nullable=False),
        sa.Column("supports_port_forwarding", sa.Boolean(), nullable=False),
        sa.Column("supports_browser", sa.Boolean(), nullable=False),
        sa.Column("supports_computer_use", sa.Boolean(), nullable=False),
        sa.Column("supports_docker", sa.Boolean(), nullable=False),
        sa.Column("node_version", sa.String(length=128), nullable=True),
        sa.Column("npm_version", sa.String(length=128), nullable=True),
        sa.Column("python_version", sa.String(length=128), nullable=True),
        sa.Column("uv_version", sa.String(length=128), nullable=True),
        sa.Column("git_version", sa.String(length=128), nullable=True),
        sa.Column("provider_readiness", JSONB, server_default=sa.text("'{}'::jsonb")),
        sa.Column("mcp_readiness", JSONB, server_default=sa.text("'{}'::jsonb")),
        sa.Column("agent_catalog_revision", sa.String(length=255), nullable=True),
        sa.Column("reported_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("target_id", name="uq_cloud_target_inventory_target_id"),
    )
    op.create_index("ix_cloud_target_inventory_target_id", "cloud_target_inventory", ["target_id"])
    op.create_index("ix_cloud_target_inventory_org_id", "cloud_target_inventory", ["org_id"])

    op.create_table(
        "cloud_commands",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=255), nullable=False),
        sa.Column("org_id", sa.Uuid(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("actor_kind", sa.String(length=32), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=True),
        sa.Column("session_id", sa.Uuid(), nullable=True),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("payload", JSONB, server_default=sa.text("'{}'::jsonb")),
        sa.Column("observed_event_seq", sa.BigInteger(), nullable=True),
        sa.Column("preconditions", JSONB, server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("authorization_context", JSONB, server_default=sa.text("'{}'::jsonb")),
        sa.Column("error_code", sa.String(length=255), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("leased_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expired_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "actor_kind IN ('user', 'automation', 'slack', 'api_key', 'system')",
            name="ck_cloud_commands_actor_kind",
        ),
        sa.CheckConstraint(
            "source IN ('web', 'mobile', 'slack', 'api', 'automation', 'desktop_cloud_view')",
            name="ck_cloud_commands_source",
        ),
        sa.CheckConstraint(
            "kind IN ('start_session', 'send_prompt', 'resolve_interaction', "
            "'update_session_config', 'cancel_turn', 'cancel_session', "
            "'stop_workspace', 'hibernate_workspace', 'resume_workspace', "
            "'prune_workspace', 'extend_workspace_ttl', 'sync_existing_workspace')",
            name="ck_cloud_commands_kind",
        ),
        sa.CheckConstraint(
            "status IN ('queued', 'leased', 'delivered', 'accepted', "
            "'accepted_but_queued', 'rejected', 'expired', 'superseded', "
            "'failed_delivery')",
            name="ck_cloud_commands_status",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_cloud_commands_org_idempotency_key",
        "cloud_commands",
        ["org_id", "idempotency_key"],
        unique=True,
    )
    op.create_index(
        "ix_cloud_commands_target_status_created",
        "cloud_commands",
        ["target_id", "status", "created_at"],
    )
    op.create_index(
        "ix_cloud_commands_session_status_created",
        "cloud_commands",
        ["session_id", "status", "created_at"],
    )
    op.create_index("ix_cloud_commands_org_id", "cloud_commands", ["org_id"])
    op.create_index("ix_cloud_commands_actor_user_id", "cloud_commands", ["actor_user_id"])
    op.create_index("ix_cloud_commands_target_id", "cloud_commands", ["target_id"])
    op.create_index("ix_cloud_commands_workspace_id", "cloud_commands", ["workspace_id"])
    op.create_index("ix_cloud_commands_session_id", "cloud_commands", ["session_id"])
    op.create_index(
        "ix_cloud_commands_lease_expires_queued",
        "cloud_commands",
        ["lease_expires_at"],
    )

    op.create_table(
        "cloud_command_leases",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("command_id", sa.Uuid(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("worker_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("leased_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["command_id"], ["cloud_commands.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["worker_id"], ["cloud_workers.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "status IN ('active', 'completed', 'expired', 'released')",
            name="ck_cloud_command_leases_status",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cloud_command_leases_command", "cloud_command_leases", ["command_id"])
    op.create_index(
        "ix_cloud_command_leases_worker_status",
        "cloud_command_leases",
        ["worker_id", "status"],
    )
    op.create_index("ix_cloud_command_leases_expires", "cloud_command_leases", ["expires_at"])
    op.create_index("ix_cloud_command_leases_target_id", "cloud_command_leases", ["target_id"])

    op.create_table(
        "cloud_session_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("org_id", sa.Uuid(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=True),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("anyharness_event_id", sa.String(length=255), nullable=True),
        sa.Column("anyharness_sequence", sa.BigInteger(), nullable=False),
        sa.Column("event_type", sa.String(length=128), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("source_kind", sa.String(length=32), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("actor_external_id", sa.String(length=255), nullable=True),
        sa.Column("payload", JSONB, nullable=True),
        sa.Column("payload_ref", sa.Text(), nullable=True),
        sa.Column("payload_size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("payload_hash", sa.String(length=64), nullable=False),
        sa.Column("dedupe_key", sa.String(length=512), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "source_kind IN ('user', 'assistant', 'tool', 'system', 'worker', 'target')",
            name="ck_cloud_session_events_source_kind",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_cloud_session_events_target_session_seq",
        "cloud_session_events",
        ["target_id", "session_id", "anyharness_sequence"],
        unique=True,
    )
    op.create_index(
        "ix_cloud_session_events_org_workspace_session_seq",
        "cloud_session_events",
        ["org_id", "workspace_id", "session_id", "anyharness_sequence"],
    )
    op.create_index(
        "ix_cloud_session_events_session_created",
        "cloud_session_events",
        ["session_id", "created_at"],
    )
    op.create_index(
        "ix_cloud_session_events_type_created",
        "cloud_session_events",
        ["event_type", "created_at"],
    )
    op.create_index("ix_cloud_session_events_org_id", "cloud_session_events", ["org_id"])
    op.create_index("ix_cloud_session_events_target_id", "cloud_session_events", ["target_id"])
    op.create_index(
        "ix_cloud_session_events_workspace_id",
        "cloud_session_events",
        ["workspace_id"],
    )
    op.create_index("ix_cloud_session_events_session_id", "cloud_session_events", ["session_id"])
    op.create_index(
        "ix_cloud_session_events_actor_user_id",
        "cloud_session_events",
        ["actor_user_id"],
    )

    op.create_table(
        "cloud_event_ingest_cursors",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("org_id", sa.Uuid(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=True),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("contiguous_sequence", sa.BigInteger(), nullable=False),
        sa.Column("highest_seen_sequence", sa.BigInteger(), nullable=False),
        sa.Column("cursor_status", sa.String(length=32), nullable=False),
        sa.Column("gap_ranges", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "cursor_status IN ('current', 'gap', 'degraded')",
            name="ck_cloud_event_ingest_cursors_status",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_cloud_event_ingest_cursors_target_session",
        "cloud_event_ingest_cursors",
        ["target_id", "session_id"],
        unique=True,
    )
    op.create_index(
        "ix_cloud_event_ingest_cursors_org_id",
        "cloud_event_ingest_cursors",
        ["org_id"],
    )
    op.create_index(
        "ix_cloud_event_ingest_cursors_target_id",
        "cloud_event_ingest_cursors",
        ["target_id"],
    )
    op.create_index(
        "ix_cloud_event_ingest_cursors_workspace_id",
        "cloud_event_ingest_cursors",
        ["workspace_id"],
    )
    op.create_index(
        "ix_cloud_event_ingest_cursors_session_id",
        "cloud_event_ingest_cursors",
        ["session_id"],
    )

    op.create_table(
        "cloud_projection_snapshots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("org_id", sa.Uuid(), nullable=False),
        sa.Column("projection_kind", sa.String(length=32), nullable=False),
        sa.Column("projection_id", sa.Uuid(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=True),
        sa.Column("session_id", sa.Uuid(), nullable=True),
        sa.Column("last_event_seq", sa.BigInteger(), nullable=False),
        sa.Column("snapshot", JSONB, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "projection_kind IN ('workspace', 'session', 'transcript', 'target')",
            name="ck_cloud_projection_snapshots_kind",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_cloud_projection_snapshots_kind_id",
        "cloud_projection_snapshots",
        ["projection_kind", "projection_id"],
        unique=True,
    )
    op.create_index(
        "ix_cloud_projection_snapshots_org_updated",
        "cloud_projection_snapshots",
        ["org_id", "updated_at"],
    )
    op.create_index(
        "ix_cloud_projection_snapshots_org_id",
        "cloud_projection_snapshots",
        ["org_id"],
    )
    op.create_index(
        "ix_cloud_projection_snapshots_projection_id",
        "cloud_projection_snapshots",
        ["projection_id"],
    )
    op.create_index(
        "ix_cloud_projection_snapshots_target_id",
        "cloud_projection_snapshots",
        ["target_id"],
    )
    op.create_index(
        "ix_cloud_projection_snapshots_workspace_id",
        "cloud_projection_snapshots",
        ["workspace_id"],
    )
    op.create_index(
        "ix_cloud_projection_snapshots_session_id",
        "cloud_projection_snapshots",
        ["session_id"],
    )

    op.create_table(
        "cloud_artifact_refs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("org_id", sa.Uuid(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=True),
        sa.Column("session_id", sa.Uuid(), nullable=True),
        sa.Column("event_id", sa.Uuid(), nullable=True),
        sa.Column("artifact_kind", sa.String(length=64), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=True),
        sa.Column("byte_size", sa.BigInteger(), nullable=True),
        sa.Column("storage_url", sa.Text(), nullable=True),
        sa.Column("storage_key", sa.Text(), nullable=True),
        sa.Column("metadata_json", JSONB, server_default=sa.text("'{}'::jsonb")),
        sa.Column("retention_state", sa.String(length=32), nullable=False),
        sa.Column("retention_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pinned", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "retention_state IN ('active', 'pinned', 'expired', 'deleted')",
            name="ck_cloud_artifact_refs_retention_state",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_cloud_artifact_refs_org_retention",
        "cloud_artifact_refs",
        ["org_id", "retention_expires_at"],
    )
    op.create_index(
        "ix_cloud_artifact_refs_workspace_session",
        "cloud_artifact_refs",
        ["workspace_id", "session_id"],
    )
    op.create_index("ix_cloud_artifact_refs_org_id", "cloud_artifact_refs", ["org_id"])
    op.create_index("ix_cloud_artifact_refs_target_id", "cloud_artifact_refs", ["target_id"])
    op.create_index(
        "ix_cloud_artifact_refs_workspace_id",
        "cloud_artifact_refs",
        ["workspace_id"],
    )
    op.create_index("ix_cloud_artifact_refs_session_id", "cloud_artifact_refs", ["session_id"])
    op.create_index("ix_cloud_artifact_refs_event_id", "cloud_artifact_refs", ["event_id"])


def downgrade() -> None:
    """Downgrade schema."""
    for table_name in (
        "cloud_artifact_refs",
        "cloud_projection_snapshots",
        "cloud_event_ingest_cursors",
        "cloud_session_events",
        "cloud_command_leases",
        "cloud_commands",
        "cloud_target_inventory",
        "cloud_target_status",
        "cloud_workers",
        "cloud_target_enrollments",
        "cloud_targets",
    ):
        op.drop_table(table_name)
