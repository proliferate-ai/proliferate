"""Repo-checkout materialization failures map to structured reasons (T1).

Regression: a transient materialization failure left Proliferate-generated files
in the shared checkout; the next attempt's ``git status`` guard exited 43 and
that non-zero exit escaped ``create_cloud_workspace_for_user`` as an opaque 500
(also what a second same-repo workspace on a dirty checkout hit). The command
error now carries its exit code, and the git-checkout guard's known exit codes
translate to a typed, product-safe ``CloudRepoCheckoutError``.
"""

from __future__ import annotations

import pytest

from proliferate.server.cloud.materialization.materialize import repo_environment
from proliferate.server.cloud.materialization.sandbox_io.target import (
    CloudMaterializationCommandError,
)


def test_command_error_carries_exit_code() -> None:
    error = CloudMaterializationCommandError("boom", exit_code=43)
    assert error.exit_code == 43


def test_command_error_exit_code_defaults_none() -> None:
    assert CloudMaterializationCommandError("boom").exit_code is None


@pytest.mark.parametrize(
    ("exit_code", "reason"),
    [
        (42, "not_a_git_repo"),
        (43, "dirty_checkout"),
        (44, "local_commits"),
    ],
)
def test_checkout_exit_codes_map_to_reasons(exit_code: int, reason: str) -> None:
    assert repo_environment._CHECKOUT_EXIT_REASONS[exit_code] == reason


def test_unknown_exit_code_has_no_reason() -> None:
    assert repo_environment._CHECKOUT_EXIT_REASONS.get(1) is None
    assert repo_environment._CHECKOUT_EXIT_REASONS.get(47) is None


def test_checkout_error_exposes_reason_and_path() -> None:
    error = repo_environment.CloudRepoCheckoutError("dirty_checkout", repo_path="/x/y")
    assert error.reason == "dirty_checkout"
    assert error.repo_path == "/x/y"
