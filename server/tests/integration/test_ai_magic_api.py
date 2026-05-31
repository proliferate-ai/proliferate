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
