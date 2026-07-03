from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import AsyncConnection

from tests.integration.background_schema_assertions import assert_background_outbox_schema
from tests.integration.sso_schema_assertions import assert_sso_schema


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
        "cloud_integration_definition",
        "cloud_integration_gateway_token",
        "cloud_integration_oauth_client",
        "cloud_integration_oauth_flow",
        "cloud_integration_policy",
        "cloud_integration_tool_schema_cache",
        "cloud_repo_environment_materialization",
        "cloud_runtime_worker",
        "cloud_runtime_worker_enrollment",
        "cloud_sandbox",
        "cloud_secret_env_var",
        "cloud_secret_file",
        "cloud_secret_set",
        "cloud_workspace",
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
        "sso_connection",
        "sso_challenge",
        "sso_identity",
        "usage_segment",
        "user",
        "webhook_event_receipt",
        "workspace_move",
    }
    assert {
        "cloud_repo_config",
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
    await assert_sso_schema(conn)

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

    cloud_sandbox_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("cloud_sandbox")
        }
    )
    assert {
        "id",
        "owner_user_id",
        "sandbox_type",
        "provider_sandbox_id",
        "status",
        "anyharness_base_url",
        "runtime_token_ciphertext",
        "anyharness_data_key_ciphertext",
        "ready_at",
        "last_health_at",
        "destroyed_at",
        "created_at",
        "updated_at",
    } <= cloud_sandbox_columns
    assert {
        "sandbox_profile_id",
        "target_id",
        "billing_subject_id",
        "template_version",
        "runtime_generation",
        "last_error",
    }.isdisjoint(cloud_sandbox_columns)
    cloud_sandbox_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("cloud_sandbox")
        }
    )
    assert {
        "ux_cloud_sandbox_personal_active",
        "ux_cloud_sandbox_provider_sandbox_id",
    } <= cloud_sandbox_indexes

    cloud_workspace_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("cloud_workspace")
        }
    )
    assert {
        "id",
        "owner_user_id",
        "repo_environment_id",
        "display_name",
        "git_branch",
        "git_base_branch",
        "anyharness_workspace_id",
        "created_at",
        "updated_at",
        "archived_at",
    } <= cloud_workspace_columns
    assert {
        "active_sandbox_id",
        "runtime_url",
        "runtime_token_ciphertext",
        "cloud_repo_config_id",
        "target_id",
        "status_detail",
        "template_version",
    }.isdisjoint(cloud_workspace_columns)

    secret_set_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("cloud_secret_set")
        }
    )
    assert {
        "id",
        "scope_kind",
        "user_id",
        "organization_id",
        "repo_environment_id",
        "version",
        "created_at",
        "updated_at",
    } <= secret_set_columns
    assert "cloud_repo_config_id" not in secret_set_columns

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
