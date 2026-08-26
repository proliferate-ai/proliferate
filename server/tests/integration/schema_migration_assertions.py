from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import AsyncConnection

from tests.integration.background_schema_assertions import assert_background_outbox_schema


async def assert_current_schema(conn: AsyncConnection, head_revision: str) -> None:
    tables = await conn.run_sync(lambda sync_conn: set(inspect(sync_conn).get_table_names()))
    assert tables >= {
        "alembic_version",
        "auth_challenge",
        "auth_identity",
        "billing_entitlement",
        "billing_grant",
        "billing_subject",
        "cloud_integration_account",
        "cloud_integration_authorization_attempt",
        "cloud_integration_definition",
        "cloud_integration_definition_security_revision",
        "cloud_integration_gateway_token",
        "cloud_integration_oauth_client",
        "cloud_integration_oauth_flow",
        "cloud_integration_policy",
        "cloud_integration_tool_schema_cache",
        "cloud_runtime_worker",
        "cloud_runtime_worker_enrollment",
        "desktop_auth_code",
        "github_app_authorizations",
        "github_app_installations",
        "github_app_installation_repositories",
        "instance_setup_token",
        "oauth_account",
        "organization",
        "organization_invitation",
        "organization_membership",
        "password_login_attempt",
        "provider_grant",
        "repo_config",
        "repo_environment",
        "usage_segment",
        "user",
        "webhook_event_receipt",
    }
    assert {
        "cloud_repo_config",
        "cloud_agent_run_config",
        "cloud_agent_run_config_default",
        "cloud_worktree_retention_policy",
        "harness_launch_option_state",
        "cloud_integration_action_approval",
        "cloud_integration_action_approval_event",
        "cloud_repo_environment_materialization",
        "cloud_sandbox",
        "cloud_secret_env_var",
        "cloud_secret_file",
        "cloud_secret_set",
        "cloud_workspace",
        "cloud_workspace_materialization",
        "cloud_repo_file",
        "cloud_runtime_environment",
        "managed_sandbox",
        "managed_sandbox_repo_materialization",
        "sandbox_profile",
        "sandbox_profile_target_state",
        "github_app_installation_links",
        "cloud_mcp_connection",
        "cloud_mcp_connection_auth",
        "cloud_mcp_connection_event",
        "cloud_mcp_oauth_client",
        "cloud_mcp_oauth_flow",
        "cloud_organization_integration_policy",
        "cloud_skill_configured_item",
        "cloud_plugin_configured_item",
        "cloud_repo_routing_profile",
        "cloud_workspace_mobility",
        "cloud_workspace_mobility_event",
        "cloud_workspace_handoff_op",
        "cloud_workspace_move_cleanup_item",
        "slack_workspace_connection",
        "slack_bot_config",
        "slack_thread_work",
        "slack_event_envelope_seen",
        "slack_inbound_event_job",
        "slack_outbound_message_queue",
    }.isdisjoint(tables)

    await assert_background_outbox_schema(conn)

    organization_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("organization")
        }
    )
    assert "is_instance" in organization_columns
    organization_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("organization")
        }
    )
    assert "ux_organization_instance" in organization_indexes

    setup_token_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("instance_setup_token")
        }
    )
    assert {"id", "token_hash", "created_at", "updated_at"} <= setup_token_columns

    repo_config_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("repo_config")
        }
    )
    assert {
        "id",
        "user_id",
        "git_provider",
        "git_owner",
        "git_repo_name",
        "commit_instructions",
        "created_at",
        "updated_at",
        "deleted_at",
    } <= repo_config_columns
    assert {"owner_scope", "organization_id", "configured"}.isdisjoint(repo_config_columns)

    repo_environment_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("repo_environment")
        }
    )
    assert {
        "id",
        "repo_config_id",
        "environment_kind",
        "desktop_install_id",
        "local_path",
        "default_branch",
        "setup_script",
        "run_command",
        "archive_script",
        "rerun_setup_on_unarchive",
        "created_at",
        "updated_at",
        "deleted_at",
    } <= repo_environment_columns
    assert {"configured", "config_version", "setup_script_version"}.isdisjoint(
        repo_environment_columns
    )
    repo_environment_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("repo_environment")
        }
    )
    assert {
        "ux_repo_environment_cloud",
        "ux_repo_environment_local_path",
    } <= repo_environment_indexes

    runtime_worker_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("cloud_runtime_worker")
        }
    )
    assert {
        "worker_version",
        "anyharness_version",
        "hostname",
        "machine_fingerprint",
    } <= runtime_worker_columns
    runtime_worker_enrollment_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"]
            for index in inspect(sync_conn).get_indexes("cloud_runtime_worker_enrollment")
        }
    )
    assert {
        "ix_cloud_runtime_worker_enrollment_desktop_fence",
        "ix_cloud_runtime_worker_enrollment_desktop_created_at",
    } <= runtime_worker_enrollment_indexes

    tool_cache_foreign_keys = await conn.run_sync(
        lambda sync_conn: {
            fk["referred_table"]
            for fk in inspect(sync_conn).get_foreign_keys("cloud_integration_tool_schema_cache")
        }
    )
    assert "cloud_integration_account" in tool_cache_foreign_keys

    integration_account_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"]
            for column in inspect(sync_conn).get_columns("cloud_integration_account")
        }
    )
    assert {
        "grant_version",
        "credential_version",
        "definition_security_revision_id",
        "provider_client_id",
        "credential_audience",
        "effective_scopes_json",
    } <= integration_account_columns
    integration_account_foreign_keys = await conn.run_sync(
        lambda sync_conn: {
            tuple(foreign_key["constrained_columns"]): foreign_key["referred_table"]
            for foreign_key in inspect(sync_conn).get_foreign_keys("cloud_integration_account")
        }
    )
    assert integration_account_foreign_keys[("definition_security_revision_id",)] == (
        "cloud_integration_definition_security_revision"
    )
    assert integration_account_foreign_keys[("provider_client_id",)] == (
        "cloud_integration_oauth_client"
    )

    oauth_client_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"]
            for column in inspect(sync_conn).get_columns("cloud_integration_oauth_client")
        }
    )
    assert {"revision", "lifecycle_state"} <= oauth_client_columns
    oauth_client_checks = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_check_constraints(
                "cloud_integration_oauth_client"
            )
        }
    )
    assert {
        "ck_cloud_integration_oauth_client_revision_positive",
        "ck_cloud_integration_oauth_client_lifecycle_state",
    } <= oauth_client_checks
    oauth_client_uniques = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_unique_constraints(
                "cloud_integration_oauth_client"
            )
        }
    )
    assert "uq_cloud_integration_oauth_client_revision" in oauth_client_uniques
    oauth_client_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"]
            for index in inspect(sync_conn).get_indexes("cloud_integration_oauth_client")
        }
    )
    assert "ux_cloud_integration_oauth_client_active" in oauth_client_indexes

    oauth_flow_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"]
            for column in inspect(sync_conn).get_columns("cloud_integration_oauth_flow")
        }
    )
    assert "attempt_id" in oauth_flow_columns
    oauth_flow_foreign_keys = await conn.run_sync(
        lambda sync_conn: {
            tuple(foreign_key["constrained_columns"]): foreign_key["referred_table"]
            for foreign_key in inspect(sync_conn).get_foreign_keys("cloud_integration_oauth_flow")
        }
    )
    assert oauth_flow_foreign_keys[("attempt_id",)] == ("cloud_integration_authorization_attempt")

    attempt_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"]
            for column in inspect(sync_conn).get_columns("cloud_integration_authorization_attempt")
        }
    )
    assert {
        "owner_user_id",
        "definition_id",
        "account_id",
        "purpose",
        "method",
        "generation",
        "status",
        "starting_grant_version",
        "starting_credential_version",
        "definition_security_revision_id",
        "provider_client_id",
        "credential_audience",
        "settings_json",
        "requested_scopes_json",
        "effective_scopes_json",
        "staged_credential_ciphertext",
        "staged_credential_format",
        "failure_code",
        "expires_at",
        "closed_at",
    } <= attempt_columns
    attempt_checks = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_check_constraints(
                "cloud_integration_authorization_attempt"
            )
        }
    )
    assert {
        "ck_cloud_integration_authorization_attempt_purpose",
        "ck_cloud_integration_authorization_attempt_method",
        "ck_cloud_integration_authorization_attempt_status",
        "ck_cloud_integration_authorization_attempt_generation_positive",
        "ck_cloud_int_auth_attempt_grant_version_positive",
        "ck_cloud_int_auth_attempt_credential_version_positive",
        "ck_cloud_integration_authorization_attempt_staged_pair",
        "ck_cloud_integration_authorization_attempt_audience",
        "ck_cloud_int_auth_attempt_starting_connection",
        "ck_cloud_int_auth_attempt_terminal_time",
    } <= attempt_checks
    attempt_uniques = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_unique_constraints(
                "cloud_integration_authorization_attempt"
            )
        }
    )
    assert "uq_cloud_integration_authorization_attempt_generation" in attempt_uniques
    attempt_foreign_keys = await conn.run_sync(
        lambda sync_conn: {
            tuple(foreign_key["constrained_columns"]): (
                foreign_key["referred_table"],
                foreign_key["options"].get("ondelete"),
            )
            for foreign_key in inspect(sync_conn).get_foreign_keys(
                "cloud_integration_authorization_attempt"
            )
        }
    )
    assert attempt_foreign_keys[("owner_user_id",)] == ("user", "CASCADE")
    assert attempt_foreign_keys[("definition_id",)][0] == "cloud_integration_definition"
    assert attempt_foreign_keys[("account_id",)] == (
        "cloud_integration_account",
        "CASCADE",
    )
    assert attempt_foreign_keys[("definition_security_revision_id",)][0] == (
        "cloud_integration_definition_security_revision"
    )
    assert attempt_foreign_keys[("provider_client_id",)][0] == ("cloud_integration_oauth_client")
    attempt_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"]
            for index in inspect(sync_conn).get_indexes("cloud_integration_authorization_attempt")
        }
    )
    assert "ux_cloud_integration_authorization_attempt_nonterminal" in attempt_indexes

    security_revision_checks = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_check_constraints(
                "cloud_integration_definition_security_revision"
            )
        }
    )
    assert {
        "ck_cloud_integration_definition_security_revision_positive",
        "ck_cloud_integration_definition_security_revision_auth_kind",
    } <= security_revision_checks
    security_revision_uniques = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_unique_constraints(
                "cloud_integration_definition_security_revision"
            )
        }
    )
    assert "uq_cloud_integration_definition_security_revision" in security_revision_uniques
    security_revision_foreign_keys = await conn.run_sync(
        lambda sync_conn: {
            tuple(foreign_key["constrained_columns"]): (
                foreign_key["referred_table"],
                foreign_key["options"].get("ondelete"),
            )
            for foreign_key in inspect(sync_conn).get_foreign_keys(
                "cloud_integration_definition_security_revision"
            )
        }
    )
    assert security_revision_foreign_keys[("definition_id",)] == (
        "cloud_integration_definition",
        "CASCADE",
    )

    github_app_installation_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("github_app_installations")
        }
    )
    assert {
        "id",
        "organization_id",
        "installed_by_user_id",
        "github_installation_id",
        "account_login",
        "account_type",
        "repository_selection",
        "permissions_json",
        "suspended_at",
        "deleted_at",
        "created_at",
        "updated_at",
    } <= github_app_installation_columns
