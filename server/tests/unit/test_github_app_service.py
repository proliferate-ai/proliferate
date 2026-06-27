from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from proliferate.integrations.github.app_user_tokens import GitHubAppUserAuthorization
from proliferate.server.cloud.github_app import service


@pytest.mark.asyncio
async def test_complete_github_app_callback_schedules_managed_sandbox_bootstrap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(service.settings, "cloud_secret_key", "test-secret")
    monkeypatch.setattr(
        service.settings,
        "github_app_callback_base_url",
        "https://api.example.test",
    )
    monkeypatch.setattr(service.settings, "api_base_url", "https://api.example.test")

    user_id = uuid.uuid4()
    state = service._state_for_user(user_id, return_to=None)
    authorization = GitHubAppUserAuthorization(
        access_token="ghu_test",
        refresh_token="refresh-test",
        expires_at=datetime.now(UTC) + timedelta(hours=8),
        refresh_token_expires_at=datetime.now(UTC) + timedelta(days=180),
        github_user_id="123",
        github_login="octo",
        permissions={},
    )
    calls: list[tuple[str, uuid.UUID | None]] = []

    async def fake_exchange_github_app_code(
        *,
        code: str,
        redirect_uri: str | None = None,
    ) -> GitHubAppUserAuthorization:
        assert code == "code-test"
        assert redirect_uri == "https://api.example.test/auth/github-app/callback"
        return authorization

    async def fake_upsert_github_app_authorization(
        db: object,
        *,
        user_id: uuid.UUID,
        authorization: GitHubAppUserAuthorization,
    ) -> None:
        del db, authorization
        calls.append(("upsert", user_id))

    async def fake_refresh_github_app_installation_cache(db: object) -> None:
        del db
        calls.append(("refresh", None))

    def fake_schedule_github_app_authorized_sandbox_bootstrap(
        db: object,
        *,
        user_id: uuid.UUID,
    ) -> None:
        del db
        calls.append(("bootstrap", user_id))

    monkeypatch.setattr(service, "exchange_github_app_code", fake_exchange_github_app_code)
    monkeypatch.setattr(
        service.github_app_store,
        "upsert_github_app_authorization",
        fake_upsert_github_app_authorization,
    )
    monkeypatch.setattr(
        service,
        "refresh_github_app_installation_cache",
        fake_refresh_github_app_installation_cache,
    )
    monkeypatch.setattr(
        service,
        "schedule_github_app_authorized_sandbox_bootstrap",
        fake_schedule_github_app_authorized_sandbox_bootstrap,
    )

    redirect_url = await service.complete_github_app_callback(
        object(),
        code="code-test",
        state=state,
    )

    assert redirect_url == service._redirect_after_callback()
    assert calls == [
        ("upsert", user_id),
        ("refresh", None),
        ("bootstrap", user_id),
    ]
