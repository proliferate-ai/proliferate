"""Sandbox bootstrap pre-clones configured repos with the right call (T1).

Regression (issue #948): `_materialize_sandbox` called
`materialize_repo_environment_in_context(db, ctx=, repo_environment=obj)`, but
that function's signature is `(db, *, ctx, repo_environment_id, materialization_id,
attempt_updated_at)`. Every GitHub-connect bootstrap for a user with >=1 cloud
repo raised a TypeError (logged, not surfaced), so no repo was pre-cloned. The
bootstrap now opens a materialization row per repo and calls with the correct
kwargs, best-effort so one repo cannot abort the whole bootstrap.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest

from proliferate.server.cloud.materialization.materialize import sandbox


class _FakeDb:
    def __init__(self) -> None:
        self.commits = 0
        self.rollbacks = 0

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1


def _ctx() -> SimpleNamespace:
    return SimpleNamespace(sandbox=SimpleNamespace(id=uuid.uuid4()), target=object())


def _patch_common(monkeypatch: pytest.MonkeyPatch, repo_envs: list[Any]) -> None:
    async def _noop(*_a: Any, **_k: Any) -> None:
        return None

    async def _list(*_a: Any, **_k: Any) -> list[Any]:
        return repo_envs

    async def _begin(*_a: Any, **_k: Any) -> Any:
        return SimpleNamespace(id=uuid.uuid4(), updated_at="2026-07-10T00:00:00Z")

    monkeypatch.setattr(sandbox.github_credentials, "materialize_github_credentials", _noop)
    monkeypatch.setattr(sandbox.secret_set, "materialize_global_secrets_for_user", _noop)
    monkeypatch.setattr(sandbox.repositories_store, "list_cloud_repo_environments", _list)
    monkeypatch.setattr(sandbox.repo_mat_store, "begin_repo_environment_materialization", _begin)


@pytest.mark.asyncio
async def test_bootstrap_materializes_each_repo_with_correct_signature(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo_envs = [SimpleNamespace(id=uuid.uuid4()), SimpleNamespace(id=uuid.uuid4())]
    _patch_common(monkeypatch, repo_envs)

    in_context_calls: list[dict[str, Any]] = []

    async def _in_context(db: Any, **kwargs: Any) -> None:
        in_context_calls.append(kwargs)

    agent_auth_calls: list[bool] = []

    async def _agent_auth(*_a: Any, **_k: Any) -> None:
        agent_auth_calls.append(True)

    monkeypatch.setattr(
        sandbox.repo_environment_materializer,
        "materialize_repo_environment_in_context",
        _in_context,
    )
    monkeypatch.setattr(sandbox.agent_auth, "materialize_agent_auth", _agent_auth)

    await sandbox._materialize_sandbox(_ctx(), db=_FakeDb(), user_id=uuid.uuid4())

    assert len(in_context_calls) == 2
    for call, repo_env in zip(in_context_calls, repo_envs, strict=True):
        # Correct signature: id + materialization id + expected timestamp, never
        # the repo object under a `repo_environment=` kwarg.
        assert call["repo_environment_id"] == repo_env.id
        assert "materialization_id" in call
        assert "attempt_updated_at" in call
        assert "repo_environment" not in call
    assert agent_auth_calls == [True]


@pytest.mark.asyncio
async def test_one_repo_failure_does_not_abort_bootstrap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo_envs = [SimpleNamespace(id=uuid.uuid4()), SimpleNamespace(id=uuid.uuid4())]
    _patch_common(monkeypatch, repo_envs)
    db = _FakeDb()

    seen: list[uuid.UUID] = []

    async def _in_context(_db: Any, *, repo_environment_id: uuid.UUID, **_k: Any) -> None:
        seen.append(repo_environment_id)
        if repo_environment_id == repo_envs[0].id:
            raise RuntimeError("transient materialization failure")

    agent_auth_calls: list[bool] = []

    async def _agent_auth(*_a: Any, **_k: Any) -> None:
        agent_auth_calls.append(True)

    monkeypatch.setattr(
        sandbox.repo_environment_materializer,
        "materialize_repo_environment_in_context",
        _in_context,
    )
    monkeypatch.setattr(sandbox.agent_auth, "materialize_agent_auth", _agent_auth)

    await sandbox._materialize_sandbox(_ctx(), db=db, user_id=uuid.uuid4())

    # Both repos attempted despite the first failing, session reset, and the
    # trailing agent-auth materialization still ran.
    assert seen == [repo_envs[0].id, repo_envs[1].id]
    assert db.rollbacks == 1
    assert agent_auth_calls == [True]
