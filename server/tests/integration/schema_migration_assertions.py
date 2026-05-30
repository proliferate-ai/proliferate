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
        "cloud_plugin_configured_item",
        "cloud_workspace_exposure",
        "cloud_skill_configured_item",
        "cloud_workspace_mobility_event",
        "cloud_workspace_handoff_op",
        "cloud_workspace_mobility",
        "cloud_workspace_move_cleanup_item",
        "cloud_sandbox",
        "cloud_target_runtime_access",
        "agent_auth_audit_event",
        "agent_auth_credential",
        "agent_auth_credential_share",
        "agent_gateway_budget_subject",
        "agent_gateway_free_credit_entitlement",
        "agent_gateway_policy",
        "agent_gateway_provider_credential",
        "agent_gateway_llm_usage_event",
        "agent_gateway_router_materialization",
        "agent_gateway_runtime_grant",
        "agent_gateway_usage_import_cursor",
        "sandbox_agent_auth_selection",
        "sandbox_profile",
        "sandbox_profile_agent_auth_revision",
        "sandbox_profile_runtime_config_artifact",
        "sandbox_profile_runtime_config_current",
        "sandbox_profile_runtime_config_revision",
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

    mobility_handoff_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"]
            for column in inspect(sync_conn).get_columns("cloud_workspace_handoff_op")
        }
    )
    assert "canonical_side" in mobility_handoff_columns
    mobility_handoff_checks = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_check_constraints(
                "cloud_workspace_handoff_op"
            )
        }
    )
    assert {
        "ck_cloud_workspace_handoff_canonical_side",
        "ck_cloud_workspace_handoff_destination_phase",
    } <= mobility_handoff_checks

    mobility_cleanup_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"]
            for column in inspect(sync_conn).get_columns("cloud_workspace_move_cleanup_item")
        }
    )
    assert {
        "id",
        "handoff_op_id",
        "item_kind",
        "target_id",
        "anyharness_workspace_id",
        "object_id",
        "status",
        "attempt_count",
        "next_attempt_at",
        "error_code",
        "error_message",
        "started_at",
        "completed_at",
        "created_at",
        "updated_at",
    } <= mobility_cleanup_columns
    mobility_cleanup_checks = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_check_constraints(
                "cloud_workspace_move_cleanup_item"
            )
        }
    )
    assert {
        "ck_cloud_workspace_move_cleanup_item_kind",
        "ck_cloud_workspace_move_cleanup_item_status",
    } <= mobility_cleanup_checks
    mobility_cleanup_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"]
            for index in inspect(sync_conn).get_indexes("cloud_workspace_move_cleanup_item")
        }
    )
    assert {
        "ix_cloud_workspace_move_cleanup_item_handoff_status",
        "ix_cloud_workspace_move_cleanup_item_due",
    } <= mobility_cleanup_indexes

    columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("cloud_workspace")
        }
    )
    assert "git_base_branch" in columns
    assert "anyharness_data_key_ciphertext" in columns
    assert "origin" in columns
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
        "ck_cloud_workspace_origin",
    } <= workspace_checks

    exposure_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("cloud_workspace_exposure")
        }
    )
    assert {
        "id",
        "target_id",
        "cloud_workspace_id",
        "anyharness_workspace_id",
        "owner_scope",
        "owner_user_id",
        "organization_id",
        "visibility",
        "claimed_by_user_id",
        "default_projection_level",
        "commandable",
        "status",
        "revision",
        "last_projected_at",
        "origin",
        "created_at",
        "updated_at",
        "archived_at",
    } <= exposure_columns
    exposure_checks = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_check_constraints("cloud_workspace_exposure")
        }
    )
    assert {
        "ck_cloud_workspace_exposure_owner_fields",
        "ck_cloud_workspace_exposure_visibility",
        "ck_cloud_workspace_exposure_projection_level",
        "ck_cloud_workspace_exposure_claimed_user",
        "ck_cloud_workspace_exposure_status",
        "ck_cloud_workspace_exposure_origin",
    } <= exposure_checks
    exposure_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("cloud_workspace_exposure")
        }
    )
    assert "ux_cloud_workspace_exposure_active" in exposure_indexes

    session_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("cloud_sessions")
        }
    )
    assert {
        "exposure_id",
        "projection_level",
        "commandable",
        "gap_state_json",
        "last_uploaded_seq",
        "agent_run_config_snapshot_json",
    } <= session_columns
    session_checks = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_check_constraints("cloud_sessions")
        }
    )
    assert "ck_cloud_sessions_projection_level" in session_checks

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
        "owner_scope",
        "owner_user_id",
        "organization_id",
        "catalog_entry_version",
        "server_name",
        "enabled",
        "public_to_org",
        "public_organization_id",
        "public_status",
        "settings_json",
        "config_version",
    } <= mcp_connection_columns
    mcp_connection_checks = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_check_constraints("cloud_mcp_connection")
        }
    )
    assert {
        "ck_cloud_mcp_connection_owner_fields",
        "ck_cloud_mcp_connection_public",
        "ck_cloud_mcp_connection_owner_scope",
        "ck_cloud_mcp_connection_public_status",
    } <= mcp_connection_checks
    mcp_connection_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("cloud_mcp_connection")
        }
    )
    assert {
        "uq_cloud_mcp_connection_personal_connection_id",
        "uq_cloud_mcp_connection_organization_connection_id",
    } <= mcp_connection_indexes

    mcp_oauth_flow_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("cloud_mcp_oauth_flow")
        }
    )
    assert {"callback_surface", "final_surface", "return_path"} <= mcp_oauth_flow_columns
    mcp_oauth_flow_column_info = await conn.run_sync(
        lambda sync_conn: {
            column["name"]: column
            for column in inspect(sync_conn).get_columns("cloud_mcp_oauth_flow")
        }
    )
    assert mcp_oauth_flow_column_info["connection_db_id"]["nullable"] is True
    mcp_oauth_flow_checks = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_check_constraints("cloud_mcp_oauth_flow")
        }
    )
    assert {
        "ck_cloud_mcp_oauth_flow_callback_surface",
        "ck_cloud_mcp_oauth_flow_final_surface",
    } <= mcp_oauth_flow_checks
    mcp_oauth_flow_foreign_keys = await conn.run_sync(
        lambda sync_conn: inspect(sync_conn).get_foreign_keys("cloud_mcp_oauth_flow")
    )
    assert any(
        foreign_key["name"] == "fk_cloud_mcp_oauth_flow_connection_db_id"
        and foreign_key["options"].get("ondelete") == "SET NULL"
        for foreign_key in mcp_oauth_flow_foreign_keys
    )

    skill_checks = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_check_constraints(
                "cloud_skill_configured_item"
            )
        }
    )
    assert {
        "ck_skill_configured_owner_fields",
        "ck_skill_configured_public",
        "ck_skill_configured_source_kind",
    } <= skill_checks

    plugin_checks = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_check_constraints(
                "cloud_plugin_configured_item"
            )
        }
    )
    assert {
        "ck_plugin_configured_owner_fields",
        "ck_plugin_configured_public",
    } <= plugin_checks

    runtime_config_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"]
            for index in inspect(sync_conn).get_indexes("sandbox_profile_runtime_config_revision")
        }
    )
    assert "ix_runtime_config_revision_profile_created" in runtime_config_indexes

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
            column["name"]: column for column in inspect(sync_conn).get_columns("cloud_sandbox")
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
    } <= set(sandbox_columns)
    assert sandbox_columns["external_sandbox_id"]["nullable"] is True
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
    runtime_access_uniques = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_unique_constraints(
                "cloud_target_runtime_access"
            )
        }
    )
    assert "uq_cloud_target_runtime_access_target_id" in runtime_access_uniques
    runtime_access_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"]
            for index in inspect(sync_conn).get_indexes("cloud_target_runtime_access")
        }
    )
    assert "ix_cloud_target_runtime_access_target_id" not in runtime_access_indexes

    target_state_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"]
            for column in inspect(sync_conn).get_columns("sandbox_profile_target_state")
        }
    )
    assert "pending_agent_auth_cleanup_json" in target_state_columns
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
        "ix_agent_gateway_runtime_grant_cloud_sandbox_id",
        "ix_agent_gateway_runtime_grant_slot",
    } <= runtime_grant_indexes

    budget_subject_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"]
            for column in inspect(sync_conn).get_columns("agent_gateway_budget_subject")
        }
    )
    assert {
        "owner_user_id",
        "entitlement_source",
        "entitlement_period_key",
    } <= budget_subject_columns
    budget_subject_checks = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_check_constraints(
                "agent_gateway_budget_subject"
            )
        }
    )
    assert {
        "ck_agent_gateway_budget_subject_owner_scope",
        "ck_agent_gateway_budget_subject_owner_fields",
    } <= budget_subject_checks
    budget_subject_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"]
            for index in inspect(sync_conn).get_indexes("agent_gateway_budget_subject")
        }
    )
    assert {
        "uq_agent_gateway_managed_budget_subject_org",
        "uq_agent_gateway_managed_budget_subject_user",
        "ix_agent_gateway_budget_subject_owner_user_id",
    } <= budget_subject_indexes

    free_credit_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"]
            for index in inspect(sync_conn).get_indexes("agent_gateway_free_credit_entitlement")
        }
    )
    assert {
        "uq_agent_gateway_free_credit_entitlement_user_period_source",
        "ix_agent_gateway_free_credit_entitlement_budget_subject",
    } <= free_credit_indexes

    router_materialization_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"]
            for index in inspect(sync_conn).get_indexes("agent_gateway_router_materialization")
        }
    )
    assert {
        "uq_agent_gateway_router_materialization_runtime",
        "uq_agent_gateway_router_materialization_policy_object",
        "uq_agent_gateway_router_materialization_budget_object",
        "ix_agent_gateway_router_materialization_object_id",
    } <= router_materialization_indexes

    router_materialization_checks = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_check_constraints(
                "agent_gateway_router_materialization"
            )
        }
    )
    assert {
        "ck_agent_gateway_router_materialization_router_kind",
        "ck_agent_gateway_router_materialization_object_kind",
        "ck_agent_gateway_router_materialization_object_scope",
        "ck_agent_gateway_router_materialization_sync_status",
        "ck_agent_gateway_router_materialization_status",
    } <= router_materialization_checks

    usage_event_indexes = await conn.run_sync(
        lambda sync_conn: {
            row[0]
            for row in sync_conn.exec_driver_sql(
                "SELECT indexname FROM pg_indexes "
                "WHERE schemaname = current_schema() "
                "AND tablename = 'agent_gateway_llm_usage_event'"
            )
        }
    )
    expected_usage_event_indexes = {
        "uq_agent_gateway_llm_usage_event_router_log",
        "ix_agent_gateway_llm_usage_event_budget_subject",
        "ix_agent_gateway_llm_usage_event_router_virtual_key",
    }
    missing_usage_event_indexes = expected_usage_event_indexes - usage_event_indexes
    assert not missing_usage_event_indexes, (
        f"missing usage indexes {sorted(missing_usage_event_indexes)} "
        f"from {sorted(usage_event_indexes)}"
    )

    usage_cursor_indexes = await conn.run_sync(
        lambda sync_conn: {
            row[0]
            for row in sync_conn.exec_driver_sql(
                "SELECT indexname FROM pg_indexes "
                "WHERE schemaname = current_schema() "
                "AND tablename = 'agent_gateway_usage_import_cursor'"
            )
        }
    )
    assert "uq_agent_gateway_usage_import_cursor_router" in usage_cursor_indexes

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
