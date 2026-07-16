from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from proliferate.integrations.github import GitHubAppInvalidGrant, GitHubIntegrationError
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
        updated_at=datetime.now(UTC) - timedelta(minutes=2),
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
        "mark_github_app_authorization_needs_reauth_if_unchanged",
        _mark,
    )

    with pytest.raises(CloudApiError) as exc_info:
        await repo_authority._refresh_github_app_authorization(
            SimpleNamespace(commit=AsyncMock()),
            user_id=authorization.user_id,
        )

    assert exc_info.value.code == "github_app_refresh_failed"
    assert exc_info.value.status_code == 502
    assert marked == []


@pytest.mark.asyncio
async def test_refresh_invalid_grant_stages_reauth_for_request_boundary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    authorization = _expired_authorization()
    marked: list[object] = []

    async def _get_authorization(*_args: object, **_kwargs: object) -> SimpleNamespace:
        return authorization

    async def _refresh(**_kwargs: object) -> None:
        raise GitHubAppInvalidGrant("expired")

    async def _mark(_db: object, authorization_id: object, **_kwargs: object) -> bool:
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
            SimpleNamespace(commit=AsyncMock()),
            user_id=authorization.user_id,
        )

    assert exc_info.value.status_code == 409
    assert marked == [authorization.id]


@pytest.mark.asyncio
async def test_refresh_invalid_grant_preserves_concurrent_rotated_authorization(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expired = _expired_authorization(refresh_token="rotated-away")
    current = _expired_authorization(refresh_token="new-refresh-token")
    current.id = expired.id
    current.user_id = expired.user_id
    current.access_token = "new-access-token"
    current.token_expires_at = datetime.now(UTC) + timedelta(hours=8)
    reads = iter((expired, current))

    async def _get_authorization(*_args: object, **_kwargs: object) -> SimpleNamespace:
        return next(reads)

    async def _refresh(**_kwargs: object) -> None:
        raise GitHubAppInvalidGrant("rotated")

    async def _mark(*_args: object, **_kwargs: object) -> bool:
        return False

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

    resolved = await repo_authority._refresh_github_app_authorization(
        SimpleNamespace(commit=AsyncMock()),
        user_id=expired.user_id,
    )

    assert resolved is current
