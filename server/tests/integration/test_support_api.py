import base64
import hashlib
import uuid

import pytest
from httpx import AsyncClient

from proliferate.config import settings


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
                    display_name="Support Tester",
                ),
            )
            await session.commit()
            user_id = str(user.id)

    assert user_id is not None

    verifier = "test-code-verifier-that-is-long-enough-for-pkce"
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")

    resp = await client.post(
        "/auth/desktop/authorize",
        params={"user_id": user_id},
        json={
            "state": f"support-state-{uuid.uuid4().hex[:8]}",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "redirect_uri": "proliferate://auth/callback",
        },
    )
    assert resp.status_code == 201
    code = resp.json()["code"]

    resp = await client.post(
        "/auth/desktop/token",
        json={
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
        },
    )
    assert resp.status_code == 200
    token_data = resp.json()
    return {"access_token": token_data["access_token"]}


class TestSupportApi:
    @pytest.mark.asyncio
    async def test_support_message_posts_to_slack(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        session = await _register_and_login(client, "support@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(
            settings,
            "support_slack_webhook_url",
            "https://hooks.slack.test/services/example",
        )

        captured: dict[str, object] = {}

        async def fake_post_incoming_webhook(
            *,
            webhook_url: str,
            text: str,
            blocks: list[dict[str, object]] | None = None,
        ) -> None:
            captured["webhook_url"] = webhook_url
            captured["text"] = text
            captured["blocks"] = blocks or []

        monkeypatch.setattr(
            "proliferate.server.support.service.post_incoming_webhook",
            fake_post_incoming_webhook,
        )

        response = await client.post(
            "/v1/support/messages",
            headers=headers,
            json={
                "message": "Need help with a cloud workspace terminal.",
                "context": {
                    "source": "sidebar",
                    "pathname": "/chat",
                    "workspaceId": "cloud:123",
                    "workspaceName": "acme/api",
                    "workspaceLocation": "cloud",
                },
            },
        )

        assert response.status_code == 200
        assert response.json() == {"ok": True}
        assert captured["webhook_url"] == "https://hooks.slack.test/services/example"
        assert "Support message from Support Tester" in str(captured["text"])
        blocks = captured["blocks"]
        assert isinstance(blocks, list)
        assert len(blocks) == 3

    @pytest.mark.asyncio
    async def test_support_message_returns_503_when_unconfigured(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        session = await _register_and_login(client, "support-missing@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(settings, "support_slack_webhook_url", "")

        response = await client.post(
            "/v1/support/messages",
            headers=headers,
            json={"message": "Test"},
        )

        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "support_unavailable"
