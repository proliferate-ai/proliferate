"""PostgreSQL transaction boundaries around managed repository I/O."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.server.cloud.github_app import repo_authority
from proliferate.server.cloud.materialization import operation
from proliferate.server.cloud.materialization.materialize import agent_auth
from proliferate.server.cloud.materialization.materialize import (
    repo_environment as repo_materializer,
)


@pytest.mark.asyncio
async def test_frozen_repo_materialization_releases_transaction_before_each_external_seam(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo_environment_id = uuid4()
    materialization_id = uuid4()
    owner_id = uuid4()
    repo = SimpleNamespace(
        id=repo_environment_id,
        user_id=owner_id,
        environment_kind="cloud",
        git_owner="acme",
        git_repo_name="widgets",
        updated_at=SimpleNamespace(),
    )
    calls: list[str] = []

    async def load_repo(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        return repo

    async def authority(db: AsyncSession, **_kwargs):  # type: ignore[no-untyped-def]
        assert not db.in_transaction()
        calls.append("github-authority")

    async def credentials(db: AsyncSession, **_kwargs):  # type: ignore[no-untyped-def]
        assert not db.in_transaction()
        calls.append("github-credentials")
        return SimpleNamespace(
            actor_login="octocat",
            actor_id="1",
            expires_at_iso="2026-07-17T00:00:00Z",
            refresh_after_iso="2026-07-16T23:30:00Z",
        )

    async def checkout(_target, **_kwargs):  # type: ignore[no-untyped-def]
        assert not db_session.in_transaction()
        calls.append("git-checkout")
        return "frozen-ref"

    async def secrets(db: AsyncSession, **_kwargs):  # type: ignore[no-untyped-def]
        assert not db.in_transaction()
        calls.append("workspace-secrets")

    async def ready(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        calls.append("ready")

    monkeypatch.setattr(
        repo_materializer.repositories_store, "get_repo_environment_by_id", load_repo
    )
    monkeypatch.setattr(repo_materializer, "require_github_cloud_repo_authority", authority)
    monkeypatch.setattr(
        repo_materializer.github_credentials,
        "materialize_github_credentials",
        credentials,
    )
    monkeypatch.setattr(repo_materializer, "_materialize_git_checkout", checkout)
    monkeypatch.setattr(
        repo_materializer.secret_set,
        "materialize_workspace_secrets_for_repo_environment",
        secrets,
    )
    monkeypatch.setattr(
        repo_materializer.repo_mat_store,
        "mark_repo_environment_materialization_ready",
        ready,
    )

    await db_session.execute(text("SELECT 1"))
    assert db_session.in_transaction()
    await repo_materializer.materialize_repo_environment_in_context(
        db_session,
        ctx=operation.MaterializationContext(
            sandbox=SimpleNamespace(id=uuid4()),
            target=SimpleNamespace(),
        ),
        repo_environment_id=repo_environment_id,
        materialization_id=materialization_id,
        attempt_updated_at=SimpleNamespace(),
        frozen_base_ref="frozen-ref",
    )

    assert calls == [
        "github-authority",
        "github-credentials",
        "git-checkout",
        "workspace-secrets",
        "ready",
    ]


@pytest.mark.asyncio
async def test_repo_authority_releases_transaction_before_github_calls(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    installation = SimpleNamespace(
        id=uuid4(),
        repository_selection="selected",
        github_installation_id="installation-a",
    )
    calls: list[str] = []

    async def authorization(db: AsyncSession, **_kwargs):  # type: ignore[no-untyped-def]
        await db.execute(text("SELECT 1"))
        return SimpleNamespace(
            access_token="token",
            github_login="octocat",
            github_user_id="1",
        )

    async def installations(db: AsyncSession, **_kwargs):  # type: ignore[no-untyped-def]
        await db.execute(text("SELECT 1"))
        return [installation]

    async def no_cache(db: AsyncSession, **_kwargs):  # type: ignore[no-untyped-def]
        await db.execute(text("SELECT 1"))
        return None

    async def coverage(**_kwargs):  # type: ignore[no-untyped-def]
        assert not db_session.in_transaction()
        calls.append("coverage")
        return SimpleNamespace(covered=True, repository_id="repo-a")

    async def cache(db: AsyncSession, **_kwargs):  # type: ignore[no-untyped-def]
        await db.execute(text("SELECT 1"))

    async def verify(**_kwargs):  # type: ignore[no-untyped-def]
        assert not db_session.in_transaction()
        calls.append("verify")
        return True

    monkeypatch.setattr(repo_authority, "require_github_app_runtime_configured", lambda: None)
    monkeypatch.setattr(repo_authority, "ensure_fresh_github_app_authorization", authorization)
    monkeypatch.setattr(
        repo_authority.github_app_store,
        "list_active_github_app_installations_for_owner",
        installations,
    )
    monkeypatch.setattr(
        repo_authority.github_app_store,
        "get_fresh_installation_repo_cache",
        no_cache,
    )
    monkeypatch.setattr(
        repo_authority,
        "fetch_installation_repo_coverage_from_github",
        coverage,
    )
    monkeypatch.setattr(
        repo_authority.github_app_store,
        "upsert_installation_repo_cache",
        cache,
    )
    monkeypatch.setattr(repo_authority, "verify_github_app_user_repo_access", verify)

    result = await repo_authority.require_github_cloud_repo_authority(
        db_session,
        user_id=uuid4(),
        git_owner="acme",
        git_repo_name="widgets",
    )

    assert result.repository_id == "repo-a"
    assert calls == ["coverage", "verify"]


@pytest.mark.asyncio
async def test_agent_auth_releases_transaction_before_sandbox_io(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    external_calls = 0

    async def build(db: AsyncSession, _user_id):  # type: ignore[no-untyped-def]
        await db.execute(text("SELECT 1"))
        return {"harnesses": {}}, "fingerprint"

    async def remove(_target, **_kwargs):  # type: ignore[no-untyped-def]
        nonlocal external_calls
        assert not db_session.in_transaction()
        external_calls += 1

    monkeypatch.setattr(agent_auth, "build_agent_auth_state", build)
    monkeypatch.setattr(agent_auth.sandbox_io, "remove_owned_files", remove)

    await agent_auth.materialize_agent_auth(
        db_session,
        ctx=operation.MaterializationContext(
            sandbox=SimpleNamespace(id=uuid4()),
            target=SimpleNamespace(),
        ),
        user_id=uuid4(),
    )

    assert external_calls == 1
