from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.integrations.github import GitHubAppInvalidGrant, GitHubIntegrationError
from proliferate.integrations.redis_lock import RedisLeaseUnavailable
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.github_app import repo_authority
from proliferate.server.cloud.github_app.errors import GitHubAppReauthorizationRequired


def _expired_authorization(*, refresh_token: str | None = "refresh-token") -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        user_id=uuid4(),
        access_token="expired-access-token",
        refresh_token=refresh_token,
        token_expires_at=datetime.now(UTC) - timedelta(minutes=1),
        status="ready",
        updated_at=datetime.now(UTC) - timedelta(hours=1),
    )


def _install_refresh_boundary_stubs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    @asynccontextmanager
    async def _lock(_user_id):  # type: ignore[no-untyped-def]
        yield

    async def _release(_db: object) -> None:
        return None

    monkeypatch.setattr(repo_authority, "_authorization_refresh_lock", _lock)
    monkeypatch.setattr(
        repo_authority.github_app_transactions,
        "release_github_app_transaction",
        _release,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "integration_error",
    [
        GitHubIntegrationError("GitHub is unavailable."),
        GitHubIntegrationError("GitHub App OAuth is not configured."),
    ],
)
async def test_refresh_transient_or_config_failure_stays_502_without_reauth(
    monkeypatch: pytest.MonkeyPatch,
    integration_error: GitHubIntegrationError,
) -> None:
    _install_refresh_boundary_stubs(monkeypatch)
    authorization = _expired_authorization()
    marked: list[object] = []

    async def _get_authorization(*_args: object, **_kwargs: object) -> SimpleNamespace:
        return authorization

    async def _refresh(**_kwargs: object) -> None:
        raise integration_error

    async def _mark(*_args: object, **_kwargs: object) -> None:
        marked.append(object())

    monkeypatch.setattr(
        repo_authority.github_app_store,
        "get_github_app_authorization_for_user",
        _get_authorization,
    )
    monkeypatch.setattr(repo_authority, "refresh_github_app_user_authorization", _refresh)
    monkeypatch.setattr(
        repo_authority.github_app_store,
        "mark_github_app_authorization_needs_reauth",
        _mark,
    )

    with pytest.raises(CloudApiError) as exc_info:
        await repo_authority._refresh_github_app_authorization(
            object(),
            user_id=authorization.user_id,
        )

    assert exc_info.value.code == "github_app_refresh_failed"
    assert exc_info.value.status_code == 502
    assert marked == []


@pytest.mark.asyncio
async def test_refresh_invalid_grant_stages_reauth_for_request_boundary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_refresh_boundary_stubs(monkeypatch)
    authorization = _expired_authorization()
    marked: list[object] = []

    async def _get_authorization(*_args: object, **_kwargs: object) -> SimpleNamespace:
        return authorization

    async def _refresh(**_kwargs: object) -> None:
        raise GitHubAppInvalidGrant("expired")

    async def _mark(
        _db: object,
        *,
        authorization_id: object,
        expected_updated_at: object,
    ) -> bool:
        assert expected_updated_at == authorization.updated_at
        marked.append(authorization_id)
        return True

    monkeypatch.setattr(
        repo_authority.github_app_store,
        "get_github_app_authorization_for_user",
        _get_authorization,
    )
    monkeypatch.setattr(repo_authority, "refresh_github_app_user_authorization", _refresh)
    monkeypatch.setattr(
        repo_authority.github_app_store,
        "mark_github_app_authorization_needs_reauth_if_unchanged",
        _mark,
    )

    with pytest.raises(GitHubAppReauthorizationRequired) as exc_info:
        await repo_authority._refresh_github_app_authorization(
            object(),
            user_id=authorization.user_id,
        )

    assert exc_info.value.status_code == 409
    assert marked == [authorization.id]


@pytest.mark.asyncio
async def test_refresh_redis_failure_is_safe_503(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _release(_db: object) -> None:
        return None

    @asynccontextmanager
    async def _unavailable(_user_id):  # type: ignore[no-untyped-def]
        raise RedisLeaseUnavailable("secret redis endpoint")
        yield

    monkeypatch.setattr(
        repo_authority.github_app_transactions,
        "release_github_app_transaction",
        _release,
    )
    monkeypatch.setattr(repo_authority, "_authorization_refresh_lock", _unavailable)

    with pytest.raises(CloudApiError) as exc_info:
        await repo_authority._refresh_github_app_authorization(
            object(),
            user_id=uuid4(),
        )

    assert exc_info.value.code == "github_app_refresh_unavailable"
    assert exc_info.value.status_code == 503
    assert "secret" not in exc_info.value.message
