"""Unit tests for the cloud AnyHarness bootstrap environment."""

from proliferate.server.cloud.runtime.bootstrap import build_runtime_env


def test_runtime_env_configures_only_the_managed_worktree_root() -> None:
    env = build_runtime_env("tok", anyharness_data_key="key")

    assert env["ANYHARNESS_WORKTREES_ROOT"] == "/home/user/workspace/worktrees"
    assert "ANYHARNESS_ENABLE_AUTOMATIC_WORKTREE_RETENTION" not in env
    assert "ANYHARNESS_DEFER_STARTUP_RETENTION" not in env
