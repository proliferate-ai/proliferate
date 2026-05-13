"""cloud worker sync v1

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-05-13 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4e5f6a7b8c9"
down_revision: str | Sequence[str] | None = "c3d4e5f6a7b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_table("cloud_target"):
        op.create_table(
            "cloud_target",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("org_id", sa.Uuid(), nullable=False),
            sa.Column("owner_user_id", sa.Uuid(), nullable=True),
            sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
            sa.Column("display_name", sa.String(length=255), nullable=False),
            sa.Column("kind", sa.String(length=64), nullable=False),
            sa.Column("access_scope", sa.String(length=32), nullable=False),
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
                name="ck_cloud_target_kind",
            ),
            sa.CheckConstraint(
                "access_scope IN ('personal', 'team', 'org')",
                name="ck_cloud_target_access_scope",
            ),
            sa.CheckConstraint(
                "persistence_class IN ('ephemeral', 'persistent', "
                "'snapshot_backed', 'unknown')",
                name="ck_cloud_target_persistence_class",
            ),
            sa.CheckConstraint(
                "direct_attach_policy IN ('disabled', 'owner_only', "
                "'team_grant', 'org_grant')",
                name="ck_cloud_target_direct_attach_policy",
            ),
            sa.CheckConstraint(
                "update_channel IN ('stable', 'beta', 'pinned')",
                name="ck_cloud_target_update_channel",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_cloud_target_org_id", "cloud_target", ["org_id"])
        op.create_index("ix_cloud_target_owner_user_id", "cloud_target", ["owner_user_id"])
        op.create_index(
            "ix_cloud_target_created_by_user_id",
            "cloud_target",
            ["created_by_user_id"],
        )
        op.create_index(
            "ix_cloud_target_org_kind_archived",
            "cloud_target",
            ["org_id", "kind", "archived_at"],
        )

    if not _has_table("cloud_worker_enrollment"):
        op.create_table(
            "cloud_worker_enrollment",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("org_id", sa.Uuid(), nullable=False),
            sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
            sa.Column("target_id", sa.Uuid(), nullable=True),
            sa.Column("target_kind", sa.String(length=64), nullable=False),
            sa.Column("display_name", sa.String(length=255), nullable=False),
            sa.Column("access_scope", sa.String(length=32), nullable=False),
            sa.Column("token_hash", sa.String(length=128), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "token_hash",
                name="uq_cloud_worker_enrollment_token_hash",
            ),
        )
        op.create_index("ix_cloud_worker_enrollment_org_id", "cloud_worker_enrollment", ["org_id"])
        op.create_index(
            "ix_cloud_worker_enrollment_created_by_user_id",
            "cloud_worker_enrollment",
            ["created_by_user_id"],
        )
        op.create_index(
            "ix_cloud_worker_enrollment_target_id",
            "cloud_worker_enrollment",
            ["target_id"],
        )
        op.create_index(
            "ix_cloud_worker_enrollment_expires",
            "cloud_worker_enrollment",
            ["expires_at", "used_at"],
        )

    if not _has_table("cloud_worker"):
        op.create_table(
            "cloud_worker",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("org_id", sa.Uuid(), nullable=False),
            sa.Column("install_id", sa.String(length=255), nullable=False),
            sa.Column("token_hash", sa.String(length=128), nullable=False),
            sa.Column("auth_version", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_heartbeat_id", sa.String(length=255), nullable=True),
            sa.Column("worker_version", sa.String(length=128), nullable=True),
            sa.Column("supervisor_version", sa.String(length=128), nullable=True),
            sa.Column("anyharness_version", sa.String(length=128), nullable=True),
            sa.Column("anyharness_endpoint_kind", sa.String(length=32), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(
                "status IN ('enrolling', 'active', 'revoked', 'rotated')",
                name="ck_cloud_worker_status",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("install_id", name="uq_cloud_worker_install_id"),
        )
        op.create_index("ix_cloud_worker_target_id", "cloud_worker", ["target_id"])
        op.create_index("ix_cloud_worker_org_id", "cloud_worker", ["org_id"])
        op.create_index("ix_cloud_worker_target_status", "cloud_worker", ["target_id", "status"])
        op.create_index("ix_cloud_worker_last_seen", "cloud_worker", ["last_seen_at"])

    if not _has_table("cloud_target_status"):
        op.create_table(
            "cloud_target_status",
            sa.Column("target_id", sa.Uuid(), nullable=False),
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
            sa.Column("safe_stop_reasons_json", sa.Text(), nullable=False),
            sa.Column("active_session_count", sa.Integer(), nullable=False),
            sa.Column("active_turn_count", sa.Integer(), nullable=False),
            sa.Column("pending_interaction_count", sa.Integer(), nullable=False),
            sa.Column("active_terminal_count", sa.Integer(), nullable=False),
            sa.Column("active_process_count", sa.Integer(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "online_status IN ('online', 'degraded', 'offline')",
                name="ck_cloud_target_status_online",
            ),
            sa.CheckConstraint(
                "safe_stop_state IN ('safe', 'blocked', 'unknown')",
                name="ck_cloud_target_status_safe_stop",
            ),
            sa.PrimaryKeyConstraint("target_id"),
        )

    if not _has_table("cloud_target_inventory"):
        op.create_table(
            "cloud_target_inventory",
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("os_kind", sa.String(length=64), nullable=True),
            sa.Column("os_version", sa.String(length=255), nullable=True),
            sa.Column("arch", sa.String(length=64), nullable=True),
            sa.Column("distro", sa.String(length=128), nullable=True),
            sa.Column("shell", sa.String(length=255), nullable=True),
            sa.Column("package_managers_json", sa.Text(), nullable=False),
            sa.Column("workspace_roots_json", sa.Text(), nullable=False),
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
            sa.Column("provider_readiness_json", sa.Text(), nullable=False),
            sa.Column("mcp_readiness_json", sa.Text(), nullable=False),
            sa.Column("agent_catalog_revision", sa.String(length=128), nullable=True),
            sa.Column("reported_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("target_id"),
        )

    if not _has_table("cloud_command"):
        op.create_table(
            "cloud_command",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("idempotency_key", sa.String(length=255), nullable=False),
            sa.Column("org_id", sa.Uuid(), nullable=False),
            sa.Column("actor_user_id", sa.Uuid(), nullable=True),
            sa.Column("actor_kind", sa.String(length=32), nullable=False),
            sa.Column("source", sa.String(length=64), nullable=False),
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("workspace_id", sa.Uuid(), nullable=True),
            sa.Column("session_id", sa.String(length=255), nullable=True),
            sa.Column("kind", sa.String(length=64), nullable=False),
            sa.Column("payload_json", sa.Text(), nullable=False),
            sa.Column("observed_event_seq", sa.Integer(), nullable=True),
            sa.Column("preconditions_json", sa.Text(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("leased_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("expired_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("authorization_context_json", sa.Text(), nullable=False),
            sa.Column("error_code", sa.String(length=128), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "status IN ('queued', 'leased', 'delivered', 'accepted', "
                "'accepted_but_queued', 'rejected', 'expired', 'superseded', "
                "'failed_delivery')",
                name="ck_cloud_command_status",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("org_id", "idempotency_key", name="uq_cloud_command_idempotency"),
        )
        op.create_index("ix_cloud_command_org_id", "cloud_command", ["org_id"])
        op.create_index("ix_cloud_command_actor_user_id", "cloud_command", ["actor_user_id"])
        op.create_index("ix_cloud_command_target_id", "cloud_command", ["target_id"])
        op.create_index("ix_cloud_command_workspace_id", "cloud_command", ["workspace_id"])
        op.create_index("ix_cloud_command_session_id", "cloud_command", ["session_id"])
        op.create_index(
            "ix_cloud_command_target_status_created",
            "cloud_command",
            ["target_id", "status", "created_at"],
        )
        op.create_index(
            "ix_cloud_command_session_status_created",
            "cloud_command",
            ["session_id", "status", "created_at"],
        )
        op.create_index("ix_cloud_command_lease_expires", "cloud_command", ["lease_expires_at"])

    if not _has_table("cloud_command_lease"):
        op.create_table(
            "cloud_command_lease",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("command_id", sa.Uuid(), nullable=False),
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("worker_id", sa.Uuid(), nullable=False),
            sa.Column("leased_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_cloud_command_lease_command_id", "cloud_command_lease", ["command_id"])
        op.create_index("ix_cloud_command_lease_target_id", "cloud_command_lease", ["target_id"])
        op.create_index("ix_cloud_command_lease_worker_id", "cloud_command_lease", ["worker_id"])
        op.create_index(
            "ix_cloud_command_lease_worker_expires",
            "cloud_command_lease",
            ["worker_id", "expires_at"],
        )

    if not _has_table("cloud_session_event"):
        op.create_table(
            "cloud_session_event",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("org_id", sa.Uuid(), nullable=False),
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("workspace_id", sa.Uuid(), nullable=True),
            sa.Column("session_id", sa.String(length=255), nullable=False),
            sa.Column("anyharness_event_id", sa.String(length=255), nullable=True),
            sa.Column("anyharness_sequence", sa.Integer(), nullable=False),
            sa.Column("event_type", sa.String(length=128), nullable=False),
            sa.Column("schema_version", sa.String(length=64), nullable=False),
            sa.Column("source_kind", sa.String(length=64), nullable=False),
            sa.Column("actor_user_id", sa.Uuid(), nullable=True),
            sa.Column("actor_external_id", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("payload_json", sa.Text(), nullable=True),
            sa.Column("payload_ref", sa.Text(), nullable=True),
            sa.Column("payload_size_bytes", sa.Integer(), nullable=False),
            sa.Column("payload_hash", sa.String(length=128), nullable=True),
            sa.Column("dedupe_key", sa.String(length=512), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "target_id",
                "session_id",
                "anyharness_sequence",
                name="uq_cloud_session_event_target_session_seq",
            ),
        )
        op.create_index("ix_cloud_session_event_org_id", "cloud_session_event", ["org_id"])
        op.create_index("ix_cloud_session_event_target_id", "cloud_session_event", ["target_id"])
        op.create_index(
            "ix_cloud_session_event_workspace_id",
            "cloud_session_event",
            ["workspace_id"],
        )
        op.create_index("ix_cloud_session_event_session_id", "cloud_session_event", ["session_id"])
        op.create_index(
            "ix_cloud_session_event_actor_user_id",
            "cloud_session_event",
            ["actor_user_id"],
        )
        op.create_index(
            "ix_cloud_session_event_workspace_session_seq",
            "cloud_session_event",
            ["org_id", "workspace_id", "session_id", "anyharness_sequence"],
        )
        op.create_index(
            "ix_cloud_session_event_session_created",
            "cloud_session_event",
            ["session_id", "created_at"],
        )
        op.create_index(
            "ix_cloud_session_event_type_created",
            "cloud_session_event",
            ["event_type", "created_at"],
        )

    if not _has_table("cloud_event_ingest_cursor"):
        op.create_table(
            "cloud_event_ingest_cursor",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("workspace_id", sa.Uuid(), nullable=True),
            sa.Column("session_id", sa.String(length=255), nullable=False),
            sa.Column("last_contiguous_sequence", sa.Integer(), nullable=False),
            sa.Column("highest_seen_sequence", sa.Integer(), nullable=False),
            sa.Column("gap_sequences_json", sa.Text(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "target_id",
                "session_id",
                name="uq_cloud_event_ingest_cursor_target_session",
            ),
        )
        op.create_index("ix_cloud_event_ingest_cursor_target_id", "cloud_event_ingest_cursor", ["target_id"])
        op.create_index("ix_cloud_event_ingest_cursor_workspace_id", "cloud_event_ingest_cursor", ["workspace_id"])
        op.create_index("ix_cloud_event_ingest_cursor_session_id", "cloud_event_ingest_cursor", ["session_id"])

    if not _has_table("cloud_projection_snapshot"):
        op.create_table(
            "cloud_projection_snapshot",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("org_id", sa.Uuid(), nullable=False),
            sa.Column("projection_kind", sa.String(length=64), nullable=False),
            sa.Column("projection_id", sa.String(length=255), nullable=False),
            sa.Column("target_id", sa.Uuid(), nullable=True),
            sa.Column("workspace_id", sa.Uuid(), nullable=True),
            sa.Column("session_id", sa.String(length=255), nullable=True),
            sa.Column("cursor", sa.String(length=255), nullable=True),
            sa.Column("snapshot_json", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "projection_kind",
                "projection_id",
                name="uq_cloud_projection_identity",
            ),
        )
        op.create_index("ix_cloud_projection_snapshot_org_id", "cloud_projection_snapshot", ["org_id"])
        op.create_index("ix_cloud_projection_snapshot_target_id", "cloud_projection_snapshot", ["target_id"])
        op.create_index("ix_cloud_projection_snapshot_workspace_id", "cloud_projection_snapshot", ["workspace_id"])
        op.create_index("ix_cloud_projection_snapshot_session_id", "cloud_projection_snapshot", ["session_id"])
        op.create_index(
            "ix_cloud_projection_org_updated",
            "cloud_projection_snapshot",
            ["org_id", "updated_at"],
        )

    if not _has_table("cloud_artifact_ref"):
        op.create_table(
            "cloud_artifact_ref",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("org_id", sa.Uuid(), nullable=False),
            sa.Column("target_id", sa.Uuid(), nullable=True),
            sa.Column("workspace_id", sa.Uuid(), nullable=True),
            sa.Column("session_id", sa.String(length=255), nullable=True),
            sa.Column("event_id", sa.Uuid(), nullable=True),
            sa.Column("kind", sa.String(length=64), nullable=False),
            sa.Column("content_type", sa.String(length=255), nullable=True),
            sa.Column("size_bytes", sa.Integer(), nullable=False),
            sa.Column("storage_uri", sa.Text(), nullable=False),
            sa.Column("metadata_json", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("retention_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_cloud_artifact_ref_org_id", "cloud_artifact_ref", ["org_id"])
        op.create_index("ix_cloud_artifact_ref_target_id", "cloud_artifact_ref", ["target_id"])
        op.create_index("ix_cloud_artifact_ref_workspace_id", "cloud_artifact_ref", ["workspace_id"])
        op.create_index("ix_cloud_artifact_ref_session_id", "cloud_artifact_ref", ["session_id"])
        op.create_index("ix_cloud_artifact_ref_event_id", "cloud_artifact_ref", ["event_id"])
        op.create_index(
            "ix_cloud_artifact_ref_retention",
            "cloud_artifact_ref",
            ["org_id", "retention_expires_at"],
        )
        op.create_index(
            "ix_cloud_artifact_ref_workspace_session",
            "cloud_artifact_ref",
            ["workspace_id", "session_id"],
        )


def downgrade() -> None:
    """Downgrade schema."""
    for table_name in (
        "cloud_artifact_ref",
        "cloud_projection_snapshot",
        "cloud_event_ingest_cursor",
        "cloud_session_event",
        "cloud_command_lease",
        "cloud_command",
        "cloud_target_inventory",
        "cloud_target_status",
        "cloud_worker",
        "cloud_worker_enrollment",
        "cloud_target",
    ):
        if _has_table(table_name):
            op.drop_table(table_name)
