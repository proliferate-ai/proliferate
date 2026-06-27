"""Cloud ORM package registration tests."""

import proliferate.db.models.cloud  # noqa: F401
from proliferate.db.models.base import Base


def test_cloud_orm_package_registers_all_cloud_tables() -> None:
    expected_tables = {
        "cloud_runtime_environment",
        "cloud_workspace",
        "cloud_workspace_exposure",
        "cloud_workspace_setup_run",
        "cloud_workspace_mobility",
        "cloud_workspace_handoff_op",
        "cloud_sandbox",
        "cloud_worktree_retention_policy",
        "cloud_integration_account",
        "cloud_integration_definition",
        "cloud_integration_oauth_client",
        "cloud_integration_oauth_flow",
        "cloud_integration_policy",
        "cloud_integration_tool_schema_cache",
        "cloud_skill_configured_item",
        "cloud_plugin_configured_item",
        "sandbox_profile_runtime_config_revision",
        "sandbox_profile_runtime_config_current",
        "sandbox_profile_runtime_config_artifact",
        "cloud_repo_config",
        "cloud_repo_file",
        "agent_auth_audit_event",
        "agent_auth_credential",
        "agent_auth_credential_share",
        "agent_gateway_budget_subject",
        "agent_gateway_llm_usage_event",
        "agent_gateway_policy",
        "agent_gateway_provider_credential",
        "agent_gateway_router_materialization",
        "agent_gateway_runtime_grant",
        "agent_gateway_usage_import_cursor",
        "sandbox_agent_auth_selection",
        "sandbox_profile",
        "sandbox_profile_agent_auth_revision",
        "sandbox_profile_target_state",
        "cloud_target_runtime_access",
        "repo_config",
        "repo_environment",
    }

    assert expected_tables <= set(Base.metadata.tables)


def test_cloud_target_runtime_access_uses_named_target_unique_constraint() -> None:
    table = Base.metadata.tables["cloud_target_runtime_access"]

    assert "uq_cloud_target_runtime_access_target_id" in {
        constraint.name for constraint in table.constraints
    }
    assert "ix_cloud_target_runtime_access_target_id" not in {
        index.name for index in table.indexes
    }
