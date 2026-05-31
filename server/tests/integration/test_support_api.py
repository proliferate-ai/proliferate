import pytest
from httpx import AsyncClient

from proliferate.config import settings
from proliferate.integrations.slack.errors import SlackWebhookError
from tests.helpers.desktop_auth import mint_desktop_token_payload


async def _register_and_login(client: AsyncClient, email: str) -> dict[str, str]:
    from proliferate.auth.models import UserCreate
    from proliferate.auth.users import UserManager
    from proliferate.db.engine import get_async_session
    from proliferate.auth.users import get_user_db

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

    token_data = await mint_desktop_token_payload(
        client,
        user_id=user_id,
        state_prefix="support-state",
    )
    return {"access_token": str(token_data["access_token"])}


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
        assert (
            response.json()["detail"]["message"]
            == "Support messaging is not configured for this environment."
        )

    @pytest.mark.asyncio
    async def test_support_message_returns_400_when_message_is_empty(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        session = await _register_and_login(client, "support-empty@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(
            settings,
            "support_slack_webhook_url",
            "https://hooks.slack.test/services/example",
        )

        response = await client.post(
            "/v1/support/messages",
            headers=headers,
            json={"message": "   "},
        )

        assert response.status_code == 400
        assert response.json()["detail"] == {
            "code": "support_message_empty",
            "message": "Support message cannot be empty.",
        }

    @pytest.mark.asyncio
    async def test_support_message_returns_502_when_delivery_fails(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        session = await _register_and_login(client, "support-failed@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(
            settings,
            "support_slack_webhook_url",
            "https://hooks.slack.test/services/example",
        )

        async def fake_post_incoming_webhook(
            *,
            webhook_url: str,
            text: str,
            blocks: list[dict[str, object]] | None = None,
        ) -> None:
            raise SlackWebhookError("boom")

        monkeypatch.setattr(
            "proliferate.server.support.service.post_incoming_webhook",
            fake_post_incoming_webhook,
        )

        response = await client.post(
            "/v1/support/messages",
            headers=headers,
            json={"message": "Need help."},
        )

        assert response.status_code == 502
        assert response.json()["detail"] == {
            "code": "support_delivery_failed",
            "message": "Support message could not be delivered.",
        }

    @pytest.mark.asyncio
    async def test_support_report_upload_creates_presigned_targets(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        session = await _register_and_login(client, "support-report@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(settings, "support_report_s3_bucket", "support-bucket")
        monkeypatch.setattr(settings, "support_report_s3_region", "us-west-2")

        records: list[dict[str, object]] = []

        async def fake_presign_put_object(
            *,
            bucket: str,
            key: str,
            content_type: str,
            expires_seconds: int,
            region_name: str | None = None,
        ) -> str:
            assert bucket == "support-bucket"
            assert content_type
            assert expires_seconds > 0
            assert region_name == "us-west-2"
            return f"https://s3.test/{key}"

        async def fake_put_json_object(
            *,
            bucket: str,
            key: str,
            value: dict[str, object],
            region_name: str | None = None,
        ) -> None:
            assert bucket == "support-bucket"
            assert key.endswith("/request.json")
            assert region_name == "us-west-2"
            records.append(value)

        monkeypatch.setattr(
            "proliferate.server.support.service.presign_put_object",
            fake_presign_put_object,
        )
        monkeypatch.setattr(
            "proliferate.server.support.service.put_json_object",
            fake_put_json_object,
        )

        response = await client.post(
            "/v1/support/report-uploads",
            headers=headers,
            json={
                "message": "The app got stuck.",
                "context": {"source": "sidebar", "pathname": "/"},
                "scope": {"kind": "most_recent_workspace", "workspaceIds": ["workspace-1"]},
                "diagnostics": {
                    "contentType": "application/json",
                    "sizeBytes": 512,
                    "sha256": "abc123",
                },
                "attachments": [
                    {
                        "clientFileId": "file-1",
                        "fileName": "screen.png",
                        "contentType": "image/png",
                        "sizeBytes": 100,
                        "sha256": "def456",
                    }
                ],
            },
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["reportId"]
        assert payload["diagnostics"]["putUrl"].startswith("https://s3.test/")
        assert payload["diagnostics"]["headers"] == {"x-amz-server-side-encryption": "AES256"}
        assert payload["attachments"][0]["clientFileId"] == "file-1"
        assert records[0]["message"] == "The app got stuck."

    @pytest.mark.asyncio
    async def test_support_report_upload_returns_503_when_storage_unconfigured(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        session = await _register_and_login(client, "support-report-missing@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(settings, "support_report_s3_bucket", "")

        response = await client.post(
            "/v1/support/report-uploads",
            headers=headers,
            json={
                "message": "The app got stuck.",
                "scope": {"kind": "app_only", "workspaceIds": []},
            },
        )

        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "support_report_storage_unavailable"

    @pytest.mark.asyncio
    async def test_support_report_complete_validates_uploads_and_notifies(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        session = await _register_and_login(client, "support-report-complete@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(settings, "support_report_s3_bucket", "support-bucket")
        monkeypatch.setattr(
            settings,
            "support_slack_webhook_url",
            "https://hooks.slack.test/services/example",
        )
        monkeypatch.setattr(
            "proliferate.server.support.service._report_prefix",
            lambda report_id: f"support/reports/{report_id}",
        )

        complete_records: list[dict[str, object]] = []
        slack_messages: list[dict[str, object]] = []

        async def fake_get_json_object(
            *,
            bucket: str,
            key: str,
            region_name: str | None = None,
        ) -> dict[str, object]:
            assert bucket == "support-bucket"
            assert key == "support/reports/report123/request.json"
            return {
                "sender": {"email": "support-report-complete@example.com"},
                "message": "The app got stuck.",
                "context": {"source": "sidebar", "pathname": "/"},
                "objects": {
                    "diagnostics": {"objectKey": "support/reports/report123/diagnostics.json"},
                    "attachments": [
                        {
                            "objectKey": (
                                "support/reports/report123/attachments/file-1/screen.png"
                            )
                        }
                    ],
                },
            }

        async def fake_head_object(
            *,
            bucket: str,
            key: str,
            region_name: str | None = None,
        ) -> dict[str, object]:
            assert bucket == "support-bucket"
            return {
                "ContentLength": 512
                if key.endswith("diagnostics.json")
                else 100,
            }

        async def fake_put_json_object(
            *,
            bucket: str,
            key: str,
            value: dict[str, object],
            region_name: str | None = None,
        ) -> None:
            assert bucket == "support-bucket"
            assert key == "support/reports/report123/complete.json"
            complete_records.append(value)

        async def fake_post_incoming_webhook(
            *,
            webhook_url: str,
            text: str,
            blocks: list[dict[str, object]] | None = None,
        ) -> None:
            slack_messages.append({"webhook_url": webhook_url, "text": text, "blocks": blocks})

        monkeypatch.setattr(
            "proliferate.server.support.service.get_json_object",
            fake_get_json_object,
        )
        monkeypatch.setattr(
            "proliferate.server.support.service.head_object",
            fake_head_object,
        )
        monkeypatch.setattr(
            "proliferate.server.support.service.put_json_object",
            fake_put_json_object,
        )
        monkeypatch.setattr(
            "proliferate.server.support.service.post_incoming_webhook",
            fake_post_incoming_webhook,
        )

        response = await client.post(
            "/v1/support/reports/report123/complete",
            headers=headers,
            json={
                "diagnostics": {
                    "objectKey": "support/reports/report123/diagnostics.json",
                    "sha256": "abc123",
                    "sizeBytes": 512,
                },
                "attachments": [
                    {
                        "objectKey": "support/reports/report123/attachments/file-1/screen.png",
                        "sha256": "def456",
                        "sizeBytes": 100,
                    }
                ],
                "packageManifest": {"schemaVersion": 1},
            },
        )

        assert response.status_code == 200
        assert response.json() == {"ok": True, "reportId": "report123"}
        assert complete_records[0]["status"] == "completed"
        assert slack_messages[0]["webhook_url"] == "https://hooks.slack.test/services/example"
