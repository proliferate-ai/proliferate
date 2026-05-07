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
        "billing_entitlement",
        "billing_grant",
        "cloud_mcp_connection",
        "cloud_mcp_connection_auth",
        "cloud_mcp_oauth_client",
        "cloud_mcp_oauth_flow",
        "cloud_credential",
        "cloud_workspace_handoff_op",
        "cloud_workspace_mobility",
        "cloud_sandbox",
        "cloud_worktree_retention_policy",
        "cloud_workspace",
        "desktop_auth_code",
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

    mcp_connection_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("cloud_mcp_connection")
        }
    )
    assert {
        "org_id",
        "catalog_entry_version",
        "custom_definition_id",
        "server_name",
        "enabled",
        "settings_json",
        "config_version",
    } <= mcp_connection_columns
    custom_definition_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"]
            for column in inspect(sync_conn).get_columns("cloud_mcp_custom_definition")
        }
    )
    assert {
        "user_id",
        "definition_id",
        "version",
        "name",
        "description",
        "transport",
        "auth_kind",
        "availability",
        "template_json",
        "enabled",
        "deleted_at",
    } <= custom_definition_columns

    version = await conn.scalar(text("SELECT version_num FROM alembic_version"))
    assert version == head_revision
