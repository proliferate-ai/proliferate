from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import github_app as github_app_store
from proliferate.integrations.github import GitHubAppInvalidGrant
from proliferate.integrations.github.app_user_tokens import GitHubAppUserAuthorization
from proliferate.server.cloud.github_app import repo_authority
from proliferate.server.cloud.materialization import runner as materialization_runner
from proliferate.server.cloud.materialization.materialize import github_credentials
from tests.integration.cloud_api_helpers import register_and_login


def _configure_github_app(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make user-authorization tests exercise a complete operator config."""
    values = {
        "github_app_id": "12345",
        "github_app_slug": "test-cloud",
        "github_app_client_id": "Iv1.test-client",
        "github_app_client_secret": "test-client-secret",
        "github_app_webhook_secret": "test-webhook-secret",
        "github_app_private_key": "-----BEGIN RSA PRIVATE KEY-----",
        "github_app_private_key_path": "",
    }
    for field, value in values.items():
        monkeypatch.setattr(repo_authority.settings, field, value)


async def _seed_expired_authorization(
    db_session: AsyncSession,
    *,
    user_id: UUID,
    refresh_token: str | None = "expired-refresh-token",
) -> None:
    await github_app_store.upsert_github_app_authorization(
        db_session,
        user_id=user_id,
        authorization=GitHubAppUserAuthorization(
            access_token="expired-github-app-token",
            refresh_token=refresh_token,
            expires_at=datetime.now(UTC) - timedelta(minutes=1),
            refresh_token_expires_at=datetime.now(UTC) + timedelta(days=30),
            github_user_id="12345",
            github_login="cloud-tester",
            permissions={},
        ),
    )
    await db_session.commit()


async def _seed_current_authorization(
    db_session: AsyncSession,
    *,
    user_id: UUID,
) -> None:
    await github_app_store.upsert_github_app_authorization(
        db_session,
        user_id=user_id,
        authorization=GitHubAppUserAuthorization(
            access_token="current-github-app-token",
            refresh_token="current-refresh-token",
            expires_at=datetime.now(UTC) + timedelta(hours=8),
            refresh_token_expires_at=datetime.now(UTC) + timedelta(days=30),
            github_user_id="12345",
            github_login="cloud-tester",
            permissions={},
        ),
    )
    await db_session.commit()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "endpoint",
    [
        "/v1/cloud/repos",
        "/v1/cloud/github-app/accessible-repos",
    ],
)
async def test_repo_discovery_fails_closed_when_operator_config_is_incomplete(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    endpoint: str,
) -> None:
    for field in (
        "github_app_id",
        "github_app_slug",
        "github_app_client_id",
        "github_app_client_secret",
        "github_app_webhook_secret",
        "github_app_private_key",
        "github_app_private_key_path",
    ):
        monkeypatch.setattr(repo_authority.settings, field, "")
    session = await register_and_login(
        client,
        f"github-operator-config-{uuid4().hex[:8]}@example.com",
    )
    await _seed_current_authorization(db_session, user_id=UUID(session["user_id"]))

    response = await client.get(
        endpoint,
        headers={"Authorization": f"Bearer {session['access_token']}"},
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "github_app_not_configured"


@pytest.mark.asyncio
@pytest.mark.parametrize("failure_mode", ["bad_refresh_token", "missing_refresh_token"])
@pytest.mark.parametrize(
    "endpoint",
    [
        "/v1/cloud/repos",
        "/v1/cloud/github-app/accessible-repos",
    ],
)
async def test_permanent_refresh_failure_returns_409_and_persists_reauth(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    failure_mode: str,
    endpoint: str,
) -> None:
    _configure_github_app(monkeypatch)
    session = await register_and_login(
        client,
        f"github-reauth-{failure_mode}-{uuid4().hex[:8]}@example.com",
    )
    user_id = UUID(session["user_id"])
    await _seed_expired_authorization(
        db_session,
        user_id=user_id,
        refresh_token=(
            None if failure_mode == "missing_refresh_token" else "expired-refresh-token"
        ),
    )

    refresh_attempts: list[str] = []

    async def _refresh(*, refresh_token: str) -> None:
        refresh_attempts.append(refresh_token)
        raise GitHubAppInvalidGrant("GitHub App authorization expired.")

    monkeypatch.setattr(repo_authority, "refresh_github_app_user_authorization", _refresh)
    headers = {"Authorization": f"Bearer {session['access_token']}"}

    first = await client.get(endpoint, headers=headers)

    assert first.status_code == 409
    assert first.json() == {
        "detail": {
            "code": "github_app_authorization_expired",
            "message": ("Reconnect the Proliferate GitHub App before using GitHub Cloud repos."),
        }
    }
    persisted = await github_app_store.get_github_app_authorization_for_user(
        db_session,
        user_id=user_id,
    )
    assert persisted is not None
    assert persisted.status == "needs_reauth"

    second = await client.get(endpoint, headers=headers)

    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "github_app_authorization_expired"
    assert refresh_attempts == (
        [] if failure_mode == "missing_refresh_token" else ["expired-refresh-token"]
    )


@pytest.mark.asyncio
async def test_authority_endpoint_returns_actionable_response_and_persists_reauth(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_github_app(monkeypatch)
    session = await register_and_login(
        client,
        f"github-authority-reauth-{uuid4().hex[:8]}@example.com",
    )
    user_id = UUID(session["user_id"])
    await _seed_expired_authorization(db_session, user_id=user_id)
    refresh_attempts: list[str] = []

    async def _refresh(*, refresh_token: str) -> None:
        refresh_attempts.append(refresh_token)
        raise GitHubAppInvalidGrant("GitHub App authorization expired.")

    monkeypatch.setattr(repo_authority, "refresh_github_app_user_authorization", _refresh)
    headers = {"Authorization": f"Bearer {session['access_token']}"}
    endpoint = "/v1/cloud/github-app/repos/acme/rocket/authority"

    first = await client.get(endpoint, headers=headers)

    assert first.status_code == 200
    assert first.json() == {
        "authorized": False,
        "status": "expired_user_authorization",
        "action": "reauthorize_user",
        "message": "Reconnect the Proliferate GitHub App before using GitHub Cloud repos.",
    }
    db_session.expire_all()
    persisted = await github_app_store.get_github_app_authorization_for_user(
        db_session,
        user_id=user_id,
    )
    assert persisted is not None
    assert persisted.status == "needs_reauth"

    second = await client.get(endpoint, headers=headers)

    assert second.status_code == 200
    assert second.json() == first.json()
    assert refresh_attempts == ["expired-refresh-token"]


@pytest.mark.asyncio
async def test_background_materialization_runner_persists_reauth(
    client: AsyncClient,
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_github_app(monkeypatch)
    session = await register_and_login(
        client,
        f"github-background-reauth-{uuid4().hex[:8]}@example.com",
    )
    user_id = UUID(session["user_id"])
    await _seed_expired_authorization(db_session, user_id=user_id)
    refresh_attempts: list[str] = []

    async def _refresh(*, refresh_token: str) -> None:
        refresh_attempts.append(refresh_token)
        raise GitHubAppInvalidGrant("GitHub App authorization expired.")

    monkeypatch.setattr(repo_authority, "refresh_github_app_user_authorization", _refresh)
    monkeypatch.setattr(
        materialization_runner,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    paged: list[Exception] = []
    monkeypatch.setattr(
        materialization_runner,
        "report_critical",
        lambda exc, **_kwargs: paged.append(exc),
    )

    async def _materialize(db: AsyncSession) -> None:
        await github_credentials.materialize_github_credentials(
            db,
            target=object(),  # Refresh fails before the sandbox target is used.
            operation_id=uuid4(),
            user_id=user_id,
        )

    await materialization_runner._run_with_fresh_session(_materialize, {})

    db_session.expire_all()
    persisted = await github_app_store.get_github_app_authorization_for_user(
        db_session,
        user_id=user_id,
    )
    assert persisted is not None
    assert persisted.status == "needs_reauth"
    assert refresh_attempts == ["expired-refresh-token"]
    assert paged == []
