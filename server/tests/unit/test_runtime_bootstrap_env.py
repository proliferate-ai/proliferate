"""Unit tests for the cloud AnyHarness bootstrap environment."""

from proliferate.server.cloud.runtime.bootstrap import build_runtime_env


def test_runtime_env_enables_managed_worktree_retention() -> None:
    env = build_runtime_env("tok", anyharness_data_key="key")

    assert env["ANYHARNESS_WORKTREES_ROOT"] == "/home/user/workspace/worktrees"
    assert env["ANYHARNESS_ENABLE_AUTOMATIC_WORKTREE_RETENTION"] == "1"
