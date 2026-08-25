from __future__ import annotations

import shlex
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.server.api_errors import CloudApiError
from proliferate.server.cloud.materialization.materialize import (
    git_identity,
    repo_environment,
)
from proliferate.server.cloud.workspaces import service as workspaces_service
from proliferate.server.cloud.workspaces.models import CreateCloudWorkspaceRequest


class _FakeDb:
    def __init__(self) -> None:
        self.commits = 0

    async def commit(self) -> None:
        self.commits += 1


def _repo_environment() -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        id=uuid4(),
        user_id=uuid4(),
        environment_kind="cloud",
        git_owner="owner",
        git_repo_name="repo",
        default_branch="main",
        updated_at=now,
    )


@pytest.mark.asyncio
async def test_resolve_git_identity_uses_email_and_display_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _get_user_by_id(*_args: object) -> SimpleNamespace:
        return SimpleNamespace(email="ada@example.com", display_name="Ada Lovelace")

    monkeypatch.setattr(git_identity.users_store, "get_user_by_id", _get_user_by_id)

    identity = await git_identity.resolve_git_identity(_FakeDb(), uuid4())

    assert identity == git_identity.GitIdentity(
        name="Ada Lovelace",
        email="ada@example.com",
    )


@pytest.mark.asyncio
async def test_resolve_git_identity_falls_back_to_email_local_part(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _get_user_by_id(*_args: object) -> SimpleNamespace:
        return SimpleNamespace(email="grace.hopper@example.com", display_name=None)

    monkeypatch.setattr(git_identity.users_store, "get_user_by_id", _get_user_by_id)

    identity = await git_identity.resolve_git_identity(_FakeDb(), uuid4())

    assert identity == git_identity.GitIdentity(
        name="grace.hopper",
        email="grace.hopper@example.com",
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("email", [None, "", "   "])
async def test_resolve_git_identity_requires_email(
    monkeypatch: pytest.MonkeyPatch,
    email: str | None,
) -> None:
    async def _get_user_by_id(*_args: object) -> SimpleNamespace:
        return SimpleNamespace(email=email, display_name="No Email")

    monkeypatch.setattr(git_identity.users_store, "get_user_by_id", _get_user_by_id)

    with pytest.raises(git_identity.GitIdentityUnresolvedError):
        await git_identity.resolve_git_identity(_FakeDb(), uuid4())


@pytest.mark.asyncio
async def test_materialize_git_identity_configures_shell_quoted_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    identity = git_identity.GitIdentity(
        name="Ada O'Connor",
        email="ada.o'connor@example.com",
    )
    operation_id = uuid4()
    target = object()
    captured: dict[str, object] = {}

    async def _resolve(*_args: object) -> git_identity.GitIdentity:
        return identity

    async def _run_materialization_script(
        received_target: object,
        **kwargs: object,
    ) -> None:
        captured.update(target=received_target, **kwargs)

    monkeypatch.setattr(git_identity, "resolve_git_identity", _resolve)
    monkeypatch.setattr(
        git_identity.sandbox_io,
        "run_materialization_script",
        _run_materialization_script,
    )

    await git_identity.materialize_git_identity(
        _FakeDb(),
        target=target,
        operation_id=operation_id,
        user_id=uuid4(),
    )

    assert captured == {
        "target": target,
        "operation_id": operation_id,
        "label": "materialization_configure_git_identity",
        "script": "\n".join(
            [
                f"git config --global user.name {shlex.quote(identity.name)}",
                f"git config --global user.email {shlex.quote(identity.email)}",
            ]
        ),
        "timeout_seconds": 30,
    }


@pytest.mark.asyncio
async def test_repo_environment_materializes_identity_before_checkout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo_env = _repo_environment()
    materialization_id = uuid4()
    attempt_updated_at = datetime.now(UTC)
    target = object()
    calls: list[str] = []

    async def _get_repo_environment(*_args: object) -> SimpleNamespace:
        return repo_env

    async def _noop(*_args: object, **_kwargs: object) -> None:
        return None

    async def _github_credentials(*_args: object, **_kwargs: object) -> SimpleNamespace:
        calls.append("github_credentials")
        return SimpleNamespace(
            actor_login="ada",
            actor_id="123",
            expires_at_iso="2026-07-27T00:00:00+00:00",
            refresh_after_iso="2026-07-26T23:30:00+00:00",
        )

    async def _git_identity(*_args: object, **_kwargs: object) -> None:
        calls.append("git_identity")

    async def _checkout(*_args: object, **_kwargs: object) -> str:
        calls.append("checkout")
        return "main"

    monkeypatch.setattr(
        repo_environment.repositories_store,
        "get_repo_environment_by_id",
        _get_repo_environment,
    )
    monkeypatch.setattr(repo_environment, "require_github_cloud_repo_authority", _noop)
    monkeypatch.setattr(
        repo_environment.github_credentials,
        "materialize_github_credentials",
        _github_credentials,
    )
    monkeypatch.setattr(
        repo_environment.git_identity,
        "materialize_git_identity",
        _git_identity,
    )
    monkeypatch.setattr(repo_environment.paths, "repo_path", lambda _repo: "/repo")
    monkeypatch.setattr(repo_environment, "_materialize_git_checkout", _checkout)
    monkeypatch.setattr(
        repo_environment.secret_set,
        "materialize_workspace_secrets_for_repo_environment",
        _noop,
    )
    monkeypatch.setattr(repo_environment.manifests, "repo_manifest", lambda **_kwargs: {})
    monkeypatch.setattr(
        repo_environment.repo_mat_store,
        "mark_repo_environment_materialization_ready",
        _noop,
    )

    await repo_environment.materialize_repo_environment_in_context(
        _FakeDb(),
        ctx=SimpleNamespace(target=target),
        repo_environment_id=repo_env.id,
        materialization_id=materialization_id,
        attempt_updated_at=attempt_updated_at,
    )

    assert calls == ["github_credentials", "git_identity", "checkout"]


@pytest.mark.asyncio
async def test_git_identity_error_translates_to_cloud_api_conflict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo_env = _repo_environment()
    user = SimpleNamespace(id=repo_env.user_id)
    body = CreateCloudWorkspaceRequest.model_validate(
        {
            "gitOwner": repo_env.git_owner,
            "gitRepoName": repo_env.git_repo_name,
            "branchName": "feature/git-identity",
        }
    )

    async def _get_repo_environment(*_args: object, **_kwargs: object) -> SimpleNamespace:
        return repo_env

    async def _authority(*_args: object, **_kwargs: object) -> SimpleNamespace:
        return SimpleNamespace(access_token="token")

    async def _repo_branches(*_args: object, **_kwargs: object) -> SimpleNamespace:
        return SimpleNamespace(default_branch="main", branches=["main"])

    async def _active_branches(*_args: object, **_kwargs: object) -> list[str]:
        return []

    async def _materialize(*_args: object, **_kwargs: object) -> None:
        raise git_identity.GitIdentityUnresolvedError()

    monkeypatch.setattr(
        workspaces_service.cloud_sandboxes_service,
        "require_cloud_provisioning_configured",
        lambda: None,
    )
    monkeypatch.setattr(
        workspaces_service.repositories_store,
        "get_cloud_repo_environment",
        _get_repo_environment,
    )
    monkeypatch.setattr(
        workspaces_service,
        "require_github_cloud_repo_authority",
        _authority,
    )
    monkeypatch.setattr(
        workspaces_service,
        "get_repo_branches_for_credentials",
        _repo_branches,
    )
    monkeypatch.setattr(
        workspaces_service.cloud_workspace_store,
        "list_active_workspace_branches_for_repo_environment",
        _active_branches,
    )
    monkeypatch.setattr(
        workspaces_service.materialization_service,
        "materialize_repo_environment",
        _materialize,
    )

    with pytest.raises(CloudApiError) as raised:
        await workspaces_service.create_cloud_workspace_for_user(
            _FakeDb(),
            user,
            body,
        )

    assert raised.value.code == "git_identity_required"
    assert raised.value.status_code == 409
    assert "email" in raised.value.message
