"""Cloud ORM package registration tests."""

import proliferate.db.models.cloud  # noqa: F401
from proliferate.db.models.base import Base


def test_cloud_orm_package_registers_all_cloud_tables() -> None:
    expected_tables = {
        "cloud_workspace",
        "cloud_sandbox",
        "cloud_sandbox_secret_materialization",
        "cloud_repo_environment_materialization",
        "cloud_worktree_retention_policy",
        "cloud_runtime_worker",
        "cloud_runtime_worker_enrollment",
        "cloud_integration_gateway_token",
        "cloud_secret_set",
        "cloud_secret_env_var",
        "cloud_secret_file",
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
        "repo_config",
        "repo_environment",
    }

    assert expected_tables <= set(Base.metadata.tables)


def test_cloud_workspace_uses_active_branch_unique_index() -> None:
    table = Base.metadata.tables["cloud_workspace"]

    assert "ux_cloud_workspace_active_repo_environment_branch" in {
        index.name for index in table.indexes
    }
