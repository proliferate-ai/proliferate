from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncConnection


async def assert_current_schema(
    conn: AsyncConnection,
    head_revision: str,
) -> None:
    tables = await conn.run_sync(lambda sync_conn: set(inspect(sync_conn).get_table_names()))
    assert tables >= {
        "alembic_version",
        "anonymous_telemetry_event",
        "anonymous_telemetry_install",
        "anonymous_telemetry_local_install",
        "client_daily_activity",
        "billing_entitlement",
        "billing_grant",
        "cloud_commands",
        "cloud_mcp_connection_event",
        "cloud_mcp_connection",
        "cloud_mcp_connection_auth",
        "cloud_mcp_oauth_client",
        "cloud_mcp_oauth_flow",
        "cloud_credential",
        "cloud_workspace_mobility_event",
        "cloud_workspace_handoff_op",
        "cloud_workspace_mobility",
        "cloud_sandbox",
        "cloud_target_runtime_access",
        "agent_auth_audit_event",
        "agent_auth_credential",
        "agent_auth_credential_share",
        "agent_gateway_budget_subject",
        "agent_gateway_policy",
        "agent_gateway_provider_credential",
        "agent_gateway_runtime_grant",
        "sandbox_agent_auth_selection",
        "sandbox_profile",
        "sandbox_profile_agent_auth_revision",
        "sandbox_profile_target_state",
        "cloud_worktree_retention_policy",
        "cloud_workspace",
        "desktop_auth_code",
        "auth_identity",
        "provider_grant",
        "auth_challenge",
        "oauth_account",
        "organization",
        "organization_invitation",
        "organization_membership",
        "usage_segment",
        "user",
        "webhook_event_receipt",
    }

    columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("cloud_workspace")
        }
    )
    assert "git_base_branch" in columns
    assert "anyharness_data_key_ciphertext" in columns
    assert "origin_json" in columns
    assert {
        "owner_scope",
        "owner_user_id",
        "organization_id",
        "created_by_user_id",
        "sandbox_profile_id",
        "target_id",
        "normalized_repo_key",
        "worktree_path",
        "materialized_slot_generation",
        "required_runtime_config_sequence",
        "required_runtime_config_revision_id",
        "required_agent_auth_revision",
    } <= columns

    organization_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("organization")
        }
    )
    assert {"name", "logo_domain", "logo_image"} <= organization_columns

    workspace_checks = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_check_constraints("cloud_workspace")
        }
    )
    assert {
        "ck_cloud_workspace_owner_scope",
        "ck_cloud_workspace_personal_owner",
        "ck_cloud_workspace_organization_owner",
        "ck_cloud_workspace_created_by_user_id",
    } <= workspace_checks

    organization_membership_checks = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_check_constraints("organization_membership")
        }
    )
    assert {
        "ck_organization_membership_role",
        "ck_organization_membership_status",
    } <= organization_membership_checks

    organization_invitation_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("organization_invitation")
        }
    )
    assert "uq_organization_invitation_pending_email" in organization_invitation_indexes

    billing_subject_checks = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_check_constraints("billing_subject")
        }
    )
    assert {
        "ck_billing_subject_personal_owner",
        "ck_billing_subject_organization_owner",
    } <= billing_subject_checks

    billing_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("billing_subject")
        }
    )
    assert "uq_billing_subject_organization_id" in billing_indexes

    runtime_checks = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_check_constraints("cloud_runtime_environment")
        }
    )
    assert "ck_cloud_runtime_environment_v1_org_id_null" not in runtime_checks

    runtime_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("cloud_runtime_environment")
        }
    )
    assert "uq_cloud_runtime_environment_org_repo_policy" in runtime_indexes

    worktree_policy_checks = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_check_constraints(
                "cloud_worktree_retention_policy"
            )
        }
    )
    assert "ck_cloud_worktree_retention_policy_limit" in worktree_policy_checks

    command_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("cloud_commands")
        }
    )
    assert {
        "uq_cloud_commands_idempotency_scope_key",
        "ix_cloud_commands_target_status_created",
        "ix_cloud_commands_session_status_created",
        "ix_cloud_commands_lease_expires_at",
    } <= command_indexes

    billing_grant_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"]: column for column in inspect(sync_conn).get_columns("billing_grant")
        }
    )
    assert billing_grant_columns["user_id"]["nullable"] is True

    billing_entitlement_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"]: column
            for column in inspect(sync_conn).get_columns("billing_entitlement")
        }
    )
    assert billing_entitlement_columns["user_id"]["nullable"] is True

    user_columns = await conn.run_sync(
        lambda sync_conn: {column["name"] for column in inspect(sync_conn).get_columns("user")}
    )
    assert {"github_login", "avatar_url"} <= user_columns

    auth_identity_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("auth_identity")
        }
    )
    assert {
        "id",
        "user_id",
        "provider",
        "provider_subject",
        "email",
        "email_verified",
        "last_login_at",
    } <= auth_identity_columns
    auth_identity_uniques = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_unique_constraints("auth_identity")
        }
    )
    assert {
        "uq_auth_identity_provider_subject",
    } <= auth_identity_uniques
    auth_identity_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("auth_identity")
        }
    )
    assert "ix_auth_identity_user_provider" in auth_identity_indexes

    provider_grant_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("provider_grant")
        }
    )
    assert {
        "id",
        "user_id",
        "auth_identity_id",
        "provider",
        "access_token_ciphertext",
        "refresh_token_ciphertext",
        "scopes_json",
        "expires_at",
        "status",
        "last_verified_at",
    } <= provider_grant_columns
    provider_grant_uniques = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_unique_constraints("provider_grant")
        }
    )
    assert "uq_provider_grant_identity_provider" in provider_grant_uniques
    provider_grant_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("provider_grant")
        }
    )
    assert "ix_provider_grant_user_provider" in provider_grant_indexes

    auth_challenge_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("auth_challenge")
        }
    )
    assert {
        "id",
        "provider",
        "surface",
        "purpose",
        "state_hash",
        "nonce_hash",
        "csrf_hash",
        "user_id",
        "client_state",
        "code_challenge",
        "code_challenge_method",
        "redirect_uri",
        "expires_at",
        "consumed_at",
    } <= auth_challenge_columns
    auth_challenge_uniques = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_unique_constraints("auth_challenge")
        }
    )
    assert "uq_auth_challenge_state_hash" in auth_challenge_uniques
    auth_challenge_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("auth_challenge")
        }
    )
    assert {"ix_auth_challenge_state_hash", "ix_auth_challenge_user_id"} <= auth_challenge_indexes

    mcp_connection_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("cloud_mcp_connection")
        }
    )
    assert {
        "org_id",
        "catalog_entry_version",
        "server_name",
        "enabled",
        "settings_json",
        "config_version",
    } <= mcp_connection_columns

    agent_auth_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("agent_auth_credential")
        }
    )
    assert {
        "ix_agent_auth_credential_owner_user_kind_status",
        "ix_agent_auth_credential_org_kind_status",
    } <= agent_auth_indexes

    sandbox_profile_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("sandbox_profile")
        }
    )
    assert {
        "uq_sandbox_profile_active_personal_user",
        "uq_sandbox_profile_active_organization",
    } <= sandbox_profile_indexes

    sandbox_profile_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("sandbox_profile")
        }
    )
    assert {
        "billing_subject_id",
        "created_by_user_id",
        "desired_agent_auth_revision",
        "archived_at",
    } <= sandbox_profile_columns

    target_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("cloud_targets")
        }
    )
    assert {
        "sandbox_profile_id",
        "profile_target_role",
    } <= target_columns
    target_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("cloud_targets")
        }
    )
    assert "ux_cloud_target_primary_per_profile" in target_indexes

    sandbox_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("cloud_sandbox")
        }
    )
    assert {
        "sandbox_profile_id",
        "target_id",
        "billing_subject_id",
        "slot_generation",
        "superseded_by_sandbox_id",
        "superseded_at",
        "lifecycle_on_timeout",
        "lifecycle_auto_resume",
        "provider_timeout_seconds",
        "blocked_reason",
    } <= sandbox_columns
    sandbox_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("cloud_sandbox")
        }
    )
    assert "ux_cloud_sandbox_active_slot_per_profile_target" in sandbox_indexes

    runtime_access_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"]
            for column in inspect(sync_conn).get_columns("cloud_target_runtime_access")
        }
    )
    assert {
        "target_id",
        "sandbox_profile_id",
        "active_sandbox_id",
        "slot_generation",
        "anyharness_base_url",
        "runtime_token_ciphertext",
        "anyharness_data_key_ciphertext",
    } <= runtime_access_columns

    target_state_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"]
            for index in inspect(sync_conn).get_indexes("sandbox_profile_target_state")
        }
    )
    assert "uq_sandbox_profile_target_state_target_profile" in target_state_indexes

    runtime_grant_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"]
            for index in inspect(sync_conn).get_indexes("agent_gateway_runtime_grant")
        }
    )
    assert {
        "uq_agent_gateway_runtime_grant_token_hash",
        "ix_agent_gateway_runtime_grant_target_profile_agent",
    } <= runtime_grant_indexes

    client_daily_activity_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("client_daily_activity")
        }
    )
    assert {
        "uq_client_daily_activity_actor_day_surface",
        "uq_client_daily_activity_install_day_surface",
        "ix_client_daily_activity_date_surface",
    } <= client_daily_activity_indexes

    client_daily_activity_checks = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_check_constraints("client_daily_activity")
        }
    )
    assert {
        "ck_client_daily_activity_surface",
        "ck_client_daily_activity_identity_present",
    } <= client_daily_activity_checks

    mcp_event_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("cloud_mcp_connection_event")
        }
    )
    assert {
        "ix_cloud_mcp_connection_event_user_day",
        "ix_cloud_mcp_connection_event_connection",
        "ix_cloud_mcp_connection_event_type",
    } <= mcp_event_indexes

    mobility_event_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"]
            for index in inspect(sync_conn).get_indexes("cloud_workspace_mobility_event")
        }
    )
    assert {
        "ix_cloud_workspace_mobility_event_user_day",
        "ix_cloud_workspace_mobility_event_workspace",
        "ix_cloud_workspace_mobility_event_handoff",
        "ix_cloud_workspace_mobility_event_type",
    } <= mobility_event_indexes

    analytics_views = await conn.run_sync(
        lambda sync_conn: set(inspect(sync_conn).get_view_names(schema="analytics"))
    )
    assert {
        "daily_anonymous_usage",
        "daily_client_activity",
        "daily_cloud_workspaces",
        "daily_cloud_sessions",
        "daily_desktop_installs",
        "daily_sandboxes",
        "daily_automation_activity",
        "daily_mcp_activity",
        "daily_mobility_activity",
        "daily_new_users",
    } <= analytics_views

    version = await conn.scalar(text("SELECT version_num FROM alembic_version"))
    assert version == head_revision
