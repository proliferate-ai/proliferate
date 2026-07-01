from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest

from proliferate.integrations.github.app_installations import GitHubAppInstallationInfo
from proliferate.integrations.github.app_user_tokens import GitHubAppUserAuthorization
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.github_app import service


@dataclass(frozen=True)
class _OrgUser:
    actor_user_id: uuid.UUID
    organization_id: uuid.UUID


@pytest.mark.asyncio
async def test_complete_github_app_user_authorization_callback_stores_authorization(
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
    state = service._state_for_user_authorization(user_id, return_to=None)
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
        assert (
            redirect_uri == "https://api.example.test/auth/github-app/user-authorization/callback"
        )
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

    async def fake_ensure_personal_cloud_sandbox_exists(db: object, *, user_id: uuid.UUID):
        del db
        calls.append(("ensure_sandbox", user_id))
        return object()

    async def fake_schedule_materialize_sandbox(db: object, *, user_id: uuid.UUID) -> None:
        del db
        calls.append(("materialize", user_id))

    monkeypatch.setattr(service, "exchange_github_app_code", fake_exchange_github_app_code)
    monkeypatch.setattr(
        service.github_app_store,
        "upsert_github_app_authorization",
        fake_upsert_github_app_authorization,
    )
    monkeypatch.setattr(
        service.cloud_sandboxes_service,
        "ensure_personal_cloud_sandbox_exists",
        fake_ensure_personal_cloud_sandbox_exists,
    )
    monkeypatch.setattr(
        service.materialization_service,
        "schedule_materialize_sandbox",
        fake_schedule_materialize_sandbox,
    )
    monkeypatch.setattr(
        service,
        "refresh_github_app_installation_cache",
        fake_refresh_github_app_installation_cache,
    )
    redirect_url = await service.complete_github_app_user_authorization_callback(
        object(),
        code="code-test",
        state=state,
    )

    assert redirect_url == service._default_return_after_callback("account")
    assert calls == [
        ("upsert", user_id),
        ("ensure_sandbox", user_id),
        ("materialize", user_id),
        ("refresh", None),
    ]


@pytest.mark.asyncio
async def test_complete_github_app_installation_callback_links_installation_to_org(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(service.settings, "cloud_secret_key", "test-secret")
    monkeypatch.setattr(service.settings, "frontend_base_url", "https://app.example.test")

    actor_user_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    state = service._state_for_installation(
        user_id=actor_user_id,
        organization_id=organization_id,
        return_to=None,
    )
    installation = GitHubAppInstallationInfo(
        github_installation_id="142900805",
        account_login="proliferate-ai",
        account_type="Organization",
        repository_selection="selected",
        permissions={"contents": "read"},
    )
    calls: list[tuple[str, uuid.UUID, uuid.UUID]] = []

    async def fake_get_github_app_installation(
        *,
        installation_id: str,
    ) -> GitHubAppInstallationInfo:
        assert installation_id == "142900805"
        return installation

    async def fake_upsert_github_app_installation(
        db: object,
        *,
        installation: GitHubAppInstallationInfo,
        organization_id: uuid.UUID | None = None,
        installed_by_user_id: uuid.UUID | None = None,
    ) -> None:
        del db, installation
        assert organization_id is not None
        assert installed_by_user_id is not None
        calls.append(("upsert", organization_id, installed_by_user_id))

    async def fake_list_cloud_repo_environments_for_git_owner(db: object, *, git_owner: str):
        del db
        assert git_owner == "proliferate-ai"
        return ()

    monkeypatch.setattr(
        service,
        "get_github_app_installation",
        fake_get_github_app_installation,
    )
    monkeypatch.setattr(
        service.github_app_store,
        "upsert_github_app_installation",
        fake_upsert_github_app_installation,
    )
    monkeypatch.setattr(
        service.repositories_store,
        "list_cloud_repo_environments_for_git_owner",
        fake_list_cloud_repo_environments_for_git_owner,
    )

    redirect_url = await service.complete_github_app_installation_callback(
        object(),
        installation_id="142900805",
        setup_action="install",
        state=state,
    )

    assert redirect_url == "https://app.example.test/settings/organization"
    assert calls == [("upsert", organization_id, actor_user_id)]


@pytest.mark.asyncio
async def test_installation_callback_rejects_missing_state() -> None:
    with pytest.raises(CloudApiError):
        await service.complete_github_app_installation_callback(
            object(),
            installation_id="142900805",
            setup_action="install",
            state="",
        )


@pytest.mark.asyncio
async def test_create_github_app_installation_url_uses_app_slug_and_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(service.settings, "cloud_secret_key", "test-secret")
    monkeypatch.setattr(service.settings, "github_app_slug", "proliferate-dev")
    org_user = _OrgUser(actor_user_id=uuid.uuid4(), organization_id=uuid.uuid4())

    response = await service.create_github_app_installation_url(
        object(),
        org_user=org_user,
        return_to="proliferate://settings/organization",
    )

    assert response.installation_url.startswith(
        "https://github.com/apps/proliferate-dev/installations/new?state="
    )


@pytest.mark.asyncio
async def test_create_github_app_installation_url_allows_desktop_environment_return(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(service.settings, "cloud_secret_key", "test-secret")
    monkeypatch.setattr(service.settings, "github_app_slug", "proliferate-dev")
    org_user = _OrgUser(actor_user_id=uuid.uuid4(), organization_id=uuid.uuid4())

    response = await service.create_github_app_installation_url(
        object(),
        org_user=org_user,
        return_to="proliferate://settings/environments?source=github_app_installation_callback",
    )

    assert response.installation_url.startswith(
        "https://github.com/apps/proliferate-dev/installations/new?state="
    )
