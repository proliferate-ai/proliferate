"""Cloud ORM package registration tests."""

import proliferate.db.models.cloud  # noqa: F401
from proliferate.db.models.base import Base


def test_cloud_orm_package_registers_all_cloud_tables() -> None:
    expected_tables = {
        "cloud_workspace",
        "cloud_workspace_mobility",
        "cloud_workspace_handoff_op",
        "cloud_sandbox",
        "cloud_sandbox_secret_materialization",
        "cloud_repo_environment_materialization",
        "cloud_worktree_retention_policy",
        "cloud_mcp_connection",
        "cloud_mcp_connection_auth",
        "cloud_mcp_oauth_flow",
        "cloud_mcp_oauth_client",
        "cloud_skill_configured_item",
        "cloud_plugin_configured_item",
        "cloud_secret_set",
        "cloud_secret_env_var",
        "cloud_secret_file",
        "repo_config",
        "repo_environment",
    }

    assert expected_tables <= set(Base.metadata.tables)


def test_cloud_workspace_uses_active_branch_unique_index() -> None:
    table = Base.metadata.tables["cloud_workspace"]

    assert "ux_cloud_workspace_active_repo_environment_branch" in {
        index.name for index in table.indexes
    }
