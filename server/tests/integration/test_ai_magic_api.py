import uuid

import pytest
from httpx import AsyncClient

from proliferate.config import settings
from proliferate.server.ai_magic import service as ai_magic_service
from tests.helpers.desktop_auth import mint_desktop_token_payload


async def _register_and_login(client: AsyncClient, email: str) -> dict[str, str]:
    from proliferate.auth.models import UserCreate
    from proliferate.auth.users import UserManager
    from proliferate.db.engine import get_async_session
    from proliferate.db.models.auth import OAuthAccount
    from proliferate.auth.users import get_user_db

    user_id: str | None = None
    async for session in get_async_session():
        async for user_db in get_user_db(session):
            manager = UserManager(user_db)
            user = await manager.create(
                UserCreate(
                    email=email,
                    password="unused-oauth-only",
                    display_name="AI Magic Tester",
                ),
            )
            session.add(
                OAuthAccount(
                    user_id=user.id,
                    oauth_name="github",
                    access_token="github-access-token",
                    account_id=f"github-{user.id}",
                    account_email=email,
                )
            )
            await session.commit()
            user_id = str(user.id)

    assert user_id is not None

    token_data = await mint_desktop_token_payload(
        client,
        user_id=user_id,
        state_prefix="ai-magic-state",
    )
    return {"access_token": str(token_data["access_token"])}


class TestAiMagicApi:
    @pytest.mark.asyncio
    async def test_generate_session_title_returns_title(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        ai_magic_service._session_title_windows.clear()
        session = await _register_and_login(client, "ai-magic@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(settings, "anthropic_api_key", "test-key")

        async def fake_generate_message_text(**_: object) -> str:
            return "# Fix auth token refresh"

        monkeypatch.setattr(
            "proliferate.server.ai_magic.service.generate_message_text",
            fake_generate_message_text,
        )

        response = await client.post(
            "/v1/ai_magic/session-titles/generate",
            headers=headers,
            json={"promptText": "Fix the auth token refresh logic in the API client."},
        )

        assert response.status_code == 200
        assert response.json() == {"title": "Fix auth token refresh"}

    @pytest.mark.asyncio
    async def test_generate_session_title_rate_limits_per_user(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        ai_magic_service._session_title_windows.clear()
        session = await _register_and_login(client, "ai-magic-limit@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
        monkeypatch.setattr(ai_magic_service, "SESSION_TITLE_RATE_LIMIT_REQUESTS", 1)
        monkeypatch.setattr(ai_magic_service, "SESSION_TITLE_RATE_LIMIT_WINDOW_SECONDS", 600)

        async def fake_generate_message_text(**_: object) -> str:
            return "Investigate flaky branch rename"

        monkeypatch.setattr(
            "proliferate.server.ai_magic.service.generate_message_text",
            fake_generate_message_text,
        )

        first = await client.post(
            "/v1/ai_magic/session-titles/generate",
            headers=headers,
            json={"promptText": "Investigate flaky branch rename timing."},
        )
        second = await client.post(
            "/v1/ai_magic/session-titles/generate",
            headers=headers,
            json={"promptText": "Investigate flaky branch rename timing."},
        )

        assert first.status_code == 200
        assert second.status_code == 429
        assert second.json()["detail"]["code"] == "ai_magic_rate_limited"

    @pytest.mark.asyncio
    async def test_generate_workspace_name_returns_name(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        ai_magic_service._workspace_name_windows.clear()
        session = await _register_and_login(client, "ai-magic-ws@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(settings, "anthropic_api_key", "test-key")

        async def fake_generate_message_text(**_: object) -> str:
            return "# Auth token refresh"

        monkeypatch.setattr(
            "proliferate.server.ai_magic.service.generate_message_text",
            fake_generate_message_text,
        )

        response = await client.post(
            "/v1/ai_magic/workspace-names/generate",
            headers=headers,
            json={"promptText": "Fix the auth token refresh logic in the API client."},
        )

        assert response.status_code == 200
        assert response.json() == {"name": "Auth token refresh"}

    @pytest.mark.asyncio
    async def test_generate_workspace_name_rate_limits_per_user(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        ai_magic_service._workspace_name_windows.clear()
        session = await _register_and_login(client, "ai-magic-ws-limit@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
        monkeypatch.setattr(ai_magic_service, "WORKSPACE_NAME_RATE_LIMIT_REQUESTS", 1)
        monkeypatch.setattr(ai_magic_service, "WORKSPACE_NAME_RATE_LIMIT_WINDOW_SECONDS", 600)

        async def fake_generate_message_text(**_: object) -> str:
            return "Branch rename timing"

        monkeypatch.setattr(
            "proliferate.server.ai_magic.service.generate_message_text",
            fake_generate_message_text,
        )

        first = await client.post(
            "/v1/ai_magic/workspace-names/generate",
            headers=headers,
            json={"promptText": "Investigate flaky branch rename timing."},
        )
        second = await client.post(
            "/v1/ai_magic/workspace-names/generate",
            headers=headers,
            json={"promptText": "Investigate flaky branch rename timing."},
        )

        assert first.status_code == 200
        assert second.status_code == 429
        assert second.json()["detail"]["code"] == "ai_magic_rate_limited"

    @pytest.mark.asyncio
    async def test_generate_commit_message_returns_message(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        ai_magic_service._commit_message_windows.clear()
        session = await _register_and_login(client, "ai-magic-commit@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(settings, "anthropic_api_key", "test-key")

        async def fake_generate_message_text(**_: object) -> str:
            return "feat: add token refresh handling"

        monkeypatch.setattr(
            "proliferate.server.ai_magic.service.generate_message_text",
            fake_generate_message_text,
        )

        response = await client.post(
            "/v1/ai_magic/commit-messages/generate",
            headers=headers,
            json={
                "diffText": "diff --git a/auth.py b/auth.py\n+def refresh(): ...\n",
            },
        )

        assert response.status_code == 200
        assert response.json() == {"message": "feat: add token refresh handling"}

    @pytest.mark.asyncio
    async def test_generate_commit_message_normalization_keeps_conventional_prefix(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        ai_magic_service._commit_message_windows.clear()
        session = await _register_and_login(client, "ai-magic-commit-norm@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(settings, "anthropic_api_key", "test-key")

        async def fake_generate_message_text(**_: object) -> str:
            # Wrapped in backticks like a markdown code span; the leading
            # "feat:" conventional-commit prefix must survive normalization.
            return "`feat: add token refresh handling`"

        monkeypatch.setattr(
            "proliferate.server.ai_magic.service.generate_message_text",
            fake_generate_message_text,
        )

        response = await client.post(
            "/v1/ai_magic/commit-messages/generate",
            headers=headers,
            json={
                "diffText": "diff --git a/auth.py b/auth.py\n+def refresh(): ...\n",
            },
        )

        assert response.status_code == 200
        assert response.json() == {"message": "feat: add token refresh handling"}

    @pytest.mark.asyncio
    async def test_generate_commit_message_rate_limits_per_user(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        ai_magic_service._commit_message_windows.clear()
        session = await _register_and_login(client, "ai-magic-commit-limit@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
        monkeypatch.setattr(ai_magic_service, "COMMIT_MESSAGE_RATE_LIMIT_REQUESTS", 1)
        monkeypatch.setattr(ai_magic_service, "COMMIT_MESSAGE_RATE_LIMIT_WINDOW_SECONDS", 600)

        async def fake_generate_message_text(**_: object) -> str:
            return "fix: handle expired session tokens"

        monkeypatch.setattr(
            "proliferate.server.ai_magic.service.generate_message_text",
            fake_generate_message_text,
        )

        body = {"diffText": "diff --git a/a.py b/a.py\n+pass\n"}
        first = await client.post(
            "/v1/ai_magic/commit-messages/generate",
            headers=headers,
            json=body,
        )
        second = await client.post(
            "/v1/ai_magic/commit-messages/generate",
            headers=headers,
            json=body,
        )

        assert first.status_code == 200
        assert second.status_code == 429
        assert second.json()["detail"]["code"] == "ai_magic_rate_limited"

    @pytest.mark.asyncio
    async def test_generate_commit_message_returns_503_when_unconfigured(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        ai_magic_service._commit_message_windows.clear()
        session = await _register_and_login(client, "ai-magic-commit-unconfigured@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(settings, "anthropic_api_key", "")

        response = await client.post(
            "/v1/ai_magic/commit-messages/generate",
            headers=headers,
            json={"diffText": "diff --git a/a.py b/a.py\n+pass\n"},
        )

        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "ai_magic_unavailable"

    @pytest.mark.asyncio
    async def test_generate_commit_message_includes_repo_instructions(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        ai_magic_service._commit_message_windows.clear()
        session = await _register_and_login(client, "ai-magic-commit-instr@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(settings, "anthropic_api_key", "test-key")

        patch_response = await client.patch(
            "/v1/cloud/repositories/acme/rocket",
            headers=headers,
            json={"commitInstructions": "Always reference the ticket number."},
        )
        assert patch_response.status_code == 200
        assert patch_response.json()["commitInstructions"] == "Always reference the ticket number."

        captured: dict[str, object] = {}

        async def fake_generate_message_text(**kwargs: object) -> str:
            captured["user_prompt"] = kwargs["user_prompt"]
            return "fix: reference ticket in commit message"

        monkeypatch.setattr(
            "proliferate.server.ai_magic.service.generate_message_text",
            fake_generate_message_text,
        )

        response = await client.post(
            "/v1/ai_magic/commit-messages/generate",
            headers=headers,
            json={
                "diffText": "diff --git a/a.py b/a.py\n+print('hi')\n",
                "gitOwner": "acme",
                "gitRepoName": "rocket",
            },
        )

        assert response.status_code == 200
        assert response.json() == {"message": "fix: reference ticket in commit message"}
        assert "Repository instructions:" in captured["user_prompt"]
        assert "Always reference the ticket number." in captured["user_prompt"]

    @pytest.mark.asyncio
    async def test_generate_commit_message_missing_repo_config_is_not_an_error(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        ai_magic_service._commit_message_windows.clear()
        session = await _register_and_login(client, "ai-magic-commit-norepo@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(settings, "anthropic_api_key", "test-key")

        async def fake_generate_message_text(**_: object) -> str:
            return "chore: tidy up unrelated repo request"

        monkeypatch.setattr(
            "proliferate.server.ai_magic.service.generate_message_text",
            fake_generate_message_text,
        )

        response = await client.post(
            "/v1/ai_magic/commit-messages/generate",
            headers=headers,
            json={
                "diffText": "diff --git a/a.py b/a.py\n+pass\n",
                "gitOwner": "nobody",
                "gitRepoName": "does-not-exist",
            },
        )

        assert response.status_code == 200
        assert response.json() == {"message": "chore: tidy up unrelated repo request"}

    @pytest.mark.asyncio
    async def test_generate_commit_message_truncates_diff(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        ai_magic_service._commit_message_windows.clear()
        monkeypatch.setattr(settings, "anthropic_api_key", "test-key")

        captured: dict[str, object] = {}

        async def fake_generate_message_text(**kwargs: object) -> str:
            captured["user_prompt"] = kwargs["user_prompt"]
            return "fix: handle an oversized diff payload"

        monkeypatch.setattr(
            "proliferate.server.ai_magic.service.generate_message_text",
            fake_generate_message_text,
        )

        oversized_diff = "x" * (ai_magic_service.COMMIT_MESSAGE_MAX_DIFF_CHARS + 5000)
        message = await ai_magic_service.generate_commit_message(
            uuid.uuid4(),
            diff_text=oversized_diff,
        )

        assert message == "fix: handle an oversized diff payload"
        diff_in_prompt = captured["user_prompt"].split("Diff:\n", 1)[1]
        assert len(diff_in_prompt) == ai_magic_service.COMMIT_MESSAGE_MAX_DIFF_CHARS
