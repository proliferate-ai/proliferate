from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
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
    authorization = _expired_authorization()
    marked: list[object] = []

    async def _get_authorization(*_args: object, **_kwargs: object) -> SimpleNamespace:
        return authorization

    async def _refresh(**_kwargs: object) -> None:
        raise GitHubAppInvalidGrant("expired")

    async def _mark(_db: object, authorization_id: object) -> None:
        marked.append(authorization_id)

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

    with pytest.raises(GitHubAppReauthorizationRequired) as exc_info:
        await repo_authority._refresh_github_app_authorization(
            object(),
            user_id=authorization.user_id,
        )

    assert exc_info.value.status_code == 409
    assert marked == [authorization.id]
