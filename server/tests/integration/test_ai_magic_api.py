import base64
import hashlib
import uuid

import pytest
from httpx import AsyncClient

from proliferate.config import settings
from proliferate.server.ai_magic import service as ai_magic_service


async def _register_and_login(client: AsyncClient, email: str) -> dict[str, str]:
    from proliferate.auth.models import UserCreate
    from proliferate.auth.users import UserManager
    from proliferate.db.engine import get_async_session
    from proliferate.db.store.users import get_user_db

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
            await session.commit()
            user_id = str(user.id)

    assert user_id is not None

    verifier = "test-code-verifier-that-is-long-enough-for-pkce"
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")

    response = await client.post(
        "/auth/desktop/authorize",
        params={"user_id": user_id},
        json={
            "state": f"ai-magic-state-{uuid.uuid4().hex[:8]}",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "redirect_uri": "proliferate://auth/callback",
        },
    )
    assert response.status_code == 201
    code = response.json()["code"]

    response = await client.post(
        "/auth/desktop/token",
        json={
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
        },
    )
    assert response.status_code == 200
    token_data = response.json()
    return {"access_token": token_data["access_token"]}


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
