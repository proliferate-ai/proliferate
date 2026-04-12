from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from proliferate.server.cloud.runtime import git_operations
from proliferate.server.cloud.runtime.git_operations import (
    configure_git_identity,
    clone_repository,
    translate_clone_failure,
)


def test_translate_clone_failure_returns_repo_access_message() -> None:
    message = translate_clone_failure("remote: Write access to repository not granted.")

    assert message == (
        "Reconnect GitHub and grant repository access before creating a cloud workspace."
    )


def test_translate_clone_failure_wraps_generic_git_error() -> None:
    message = translate_clone_failure("fatal: could not read from remote repository")

    assert message == "Git clone failed: fatal: could not read from remote repository"


@pytest.mark.asyncio
async def test_clone_repository_runs_from_parent_of_runtime_workdir(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    async def fake_run_sandbox_command_logged(*args, **kwargs):
        calls.append(kwargs)
        return SimpleNamespace(exit_code=0, stdout="", stderr="")

    monkeypatch.setattr(
        git_operations,
        "run_sandbox_command_logged",
        fake_run_sandbox_command_logged,
    )

    provider = SimpleNamespace()
    runtime_context = SimpleNamespace(runtime_workdir="/home/user/workspace")
    ctx = SimpleNamespace(
        workspace_id=uuid.uuid4(),
        github_token="github-token",
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
        git_base_branch="main",
        requested_base_sha=None,
    )

    await clone_repository(provider, object(), ctx=ctx, runtime_context=runtime_context)

    clone_call = next(call for call in calls if call["label"] == "clone_repo")
    assert clone_call["cwd"] == "/home/user"
    assert "https://x-access-token:github-token@github.com/proliferate-ai/proliferate.git" in str(
        clone_call["command"]
    )


@pytest.mark.asyncio
async def test_configure_git_identity_sets_repo_local_name_and_email(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    async def fake_run_sandbox_command_logged(*args, **kwargs):
        calls.append(kwargs)
        return SimpleNamespace(exit_code=0, stdout="", stderr="")

    monkeypatch.setattr(
        git_operations,
        "run_sandbox_command_logged",
        fake_run_sandbox_command_logged,
    )

    provider = SimpleNamespace()
    runtime_context = SimpleNamespace(runtime_workdir="/home/user/workspace")
    ctx = SimpleNamespace(
        workspace_id=uuid.uuid4(),
        git_user_name="Cloud Tester",
        git_user_email="cloud@example.com",
    )

    await configure_git_identity(provider, object(), ctx=ctx, runtime_context=runtime_context)

    config_call = calls[0]
    assert config_call["label"] == "configure_git_identity"
    command = str(config_call["command"])
    assert "git -C /home/user/workspace config user.name" in command
    assert "Cloud Tester" in command
    assert "git -C /home/user/workspace config user.email cloud@example.com" in command
