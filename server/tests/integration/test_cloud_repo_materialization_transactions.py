"""PostgreSQL transaction boundaries around managed repository I/O."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from contextvars import ContextVar
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from proliferate.db.store import github_app as github_app_store
from proliferate.server.cloud.github_app import repo_authority
from proliferate.server.cloud.materialization import operation
from proliferate.server.cloud.materialization.materialize import agent_auth
from proliferate.server.cloud.materialization.materialize import github_credentials
from proliferate.server.cloud.materialization.materialize import (
    repo_environment as repo_materializer,
)
from tests.integration.cloud_api_helpers import register_and_login


def _github_authorization_payload(
    *,
    access_token: str,
    refresh_token: str,
    expires_at: datetime,
) -> SimpleNamespace:
    return SimpleNamespace(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=expires_at,
        refresh_token_expires_at=expires_at + timedelta(days=30),
        github_user_id="github-user",
        github_login="octocat",
        permissions={"contents": "write"},
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


@pytest.mark.asyncio
async def test_missing_github_access_token_is_typed_permanent_configuration(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def authorization(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        return SimpleNamespace(access_token=None)

    monkeypatch.setattr(
        github_credentials,
        "ensure_fresh_github_app_authorization",
        authorization,
    )

    with pytest.raises(operation.CloudMaterializationConfigurationError):
        await github_credentials.materialize_github_credentials(
            db_session,
            target=SimpleNamespace(),
            operation_id=uuid4(),
            user_id=uuid4(),
        )


@pytest.mark.asyncio
async def test_rotating_github_refresh_serializes_without_postgres_transaction(
    client: AsyncClient,
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = await register_and_login(client, f"github-refresh-{uuid4()}@example.com")
    owner_id = UUID(owner["user_id"])
    expired = datetime.now(UTC) - timedelta(minutes=1)
    await github_app_store.upsert_github_app_authorization(
        db_session,
        user_id=owner_id,
        authorization=_github_authorization_payload(
            access_token="expired-access",
            refresh_token="rotating-refresh",
            expires_at=expired,
        ),
    )
    await db_session.commit()

    lease = asyncio.Lock()
    current_session: ContextVar[AsyncSession] = ContextVar("github_refresh_session")
    refresh_calls = 0

    @asynccontextmanager
    async def locked(_user_id):  # type: ignore[no-untyped-def]
        assert not current_session.get().in_transaction()
        async with lease:
            yield

    async def refresh(*, refresh_token: str):  # type: ignore[no-untyped-def]
        nonlocal refresh_calls
        assert refresh_token == "rotating-refresh"
        assert not current_session.get().in_transaction()
        refresh_calls += 1
        await asyncio.sleep(0.02)
        return _github_authorization_payload(
            access_token="rotated-access",
            refresh_token="rotated-refresh",
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )

    monkeypatch.setattr(repo_authority, "_authorization_refresh_lock", locked)
    monkeypatch.setattr(repo_authority, "refresh_github_app_user_authorization", refresh)
    factory = async_sessionmaker(test_engine, expire_on_commit=False)

    async def resolve():  # type: ignore[no-untyped-def]
        async with factory() as db:
            token = current_session.set(db)
            try:
                return await repo_authority.ensure_fresh_github_app_authorization(
                    db,
                    user_id=owner_id,
                )
            finally:
                current_session.reset(token)

    first, second = await asyncio.gather(resolve(), resolve())

    assert refresh_calls == 1
    assert first.access_token == second.access_token == "rotated-access"
    assert first.refresh_token == second.refresh_token == "rotated-refresh"


@pytest.mark.asyncio
async def test_invalid_rotating_token_cannot_clobber_newer_callback_authorization(
    client: AsyncClient,
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from proliferate.integrations.github import GitHubAppInvalidGrant

    owner = await register_and_login(client, f"github-cas-{uuid4()}@example.com")
    owner_id = UUID(owner["user_id"])
    await github_app_store.upsert_github_app_authorization(
        db_session,
        user_id=owner_id,
        authorization=_github_authorization_payload(
            access_token="expired-access",
            refresh_token="stale-refresh",
            expires_at=datetime.now(UTC) - timedelta(minutes=1),
        ),
    )
    await db_session.commit()

    refresh_started = asyncio.Event()
    callback_complete = asyncio.Event()

    @asynccontextmanager
    async def locked(_user_id):  # type: ignore[no-untyped-def]
        yield

    async def invalid_refresh(*, refresh_token: str):  # type: ignore[no-untyped-def]
        assert refresh_token == "stale-refresh"
        refresh_started.set()
        await callback_complete.wait()
        raise GitHubAppInvalidGrant("rotated")

    monkeypatch.setattr(repo_authority, "_authorization_refresh_lock", locked)
    monkeypatch.setattr(
        repo_authority,
        "refresh_github_app_user_authorization",
        invalid_refresh,
    )
    factory = async_sessionmaker(test_engine, expire_on_commit=False)

    async def resolve():  # type: ignore[no-untyped-def]
        async with factory() as db:
            return await repo_authority.ensure_fresh_github_app_authorization(
                db,
                user_id=owner_id,
            )

    pending = asyncio.create_task(resolve())
    await asyncio.wait_for(refresh_started.wait(), timeout=5)
    async with factory() as callback_db:
        await github_app_store.upsert_github_app_authorization(
            callback_db,
            user_id=owner_id,
            authorization=_github_authorization_payload(
                access_token="callback-access",
                refresh_token="callback-refresh",
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            ),
        )
        await callback_db.commit()
    callback_complete.set()

    resolved = await asyncio.wait_for(pending, timeout=5)
    assert resolved.status == "ready"
    assert resolved.access_token == "callback-access"
    assert resolved.refresh_token == "callback-refresh"
