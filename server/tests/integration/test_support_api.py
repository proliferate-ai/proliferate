import json
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.billing import ensure_personal_billing_subject
from proliferate.db.store import support_reports
from proliferate.integrations.github.issues import GitHubIssue
from proliferate.integrations.linear import LinearIssue
from proliferate.server.support.tracker import run_support_tracker_reconcile_pass
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
    return {"access_token": str(token_data["access_token"]), "user_id": user_id}


async def _seed_personal_cloud_workspace(
    db_session: AsyncSession,
    *,
    user_id: str,
    suffix: str,
) -> CloudWorkspace:
    user_uuid = UUID(user_id)
    billing_subject = await ensure_personal_billing_subject(db_session, user_uuid)
    workspace = CloudWorkspace(
        user_id=user_uuid,
        owner_scope="personal",
        owner_user_id=user_uuid,
        organization_id=None,
        created_by_user_id=user_uuid,
        billing_subject_id=billing_subject.id,
        display_name=f"Support Workspace {suffix}",
        git_provider="github",
        git_owner="acme",
        git_repo_name=f"repo-{suffix}",
        normalized_repo_key=f"github/acme/repo-{suffix}",
        git_branch="main",
        git_base_branch="main",
        origin="manual_web",
        status="ready",
        status_detail="Ready",
        template_version="v1",
        runtime_generation=0,
        anyharness_workspace_id=f"workspace-{suffix}",
        repo_post_ready_phase="idle",
        repo_post_ready_files_total=0,
        repo_post_ready_files_applied=0,
        cleanup_state="none",
    )
    db_session.add(workspace)
    await db_session.commit()
    return workspace


class TestSupportApi:
    @pytest.mark.asyncio
    async def test_support_message_creates_zero_upload_report_and_notifies(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        session = await _register_and_login(client, "support@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(settings, "support_report_s3_bucket", "support-bucket")
        monkeypatch.setattr(
            settings,
            "support_slack_webhook_url",
            "https://hooks.slack.test/services/example",
        )

        captured: dict[str, object] = {}
        records: list[dict[str, object]] = []

        async def fake_put_json_object(
            *,
            bucket: str,
            key: str,
            value: dict[str, object],
            region_name: str | None = None,
        ) -> None:
            assert bucket == "support-bucket"
            assert key.endswith("/request.json") or key.endswith("/complete.json")
            records.append(value)

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
            "proliferate.server.support.service.put_json_object",
            fake_put_json_object,
        )
        monkeypatch.setattr(
            "proliferate.server.support.notifications.post_incoming_webhook",
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
        assert records[0]["schemaVersion"] == 2
        assert records[0]["publicContentConsent"] is False
        assert records[0]["expectedClientUploads"] == {
            "diagnostics": False,
            "attachmentCount": 0,
        }
        assert records[1]["status"] == "completed"
        assert captured["webhook_url"] == "https://hooks.slack.test/services/example"
        assert "Support report" in str(captured["text"])
        blocks = captured["blocks"]
        assert isinstance(blocks, list)
        assert len(blocks) >= 2

    @pytest.mark.asyncio
    async def test_support_message_returns_503_when_storage_unconfigured(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        session = await _register_and_login(client, "support-missing@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(settings, "support_report_s3_bucket", "")

        response = await client.post(
            "/v1/support/messages",
            headers=headers,
            json={"message": "Test"},
        )

        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "support_report_storage_unavailable"
        assert (
            response.json()["detail"]["message"]
            == "Support report upload storage is not configured."
        )

    @pytest.mark.asyncio
    async def test_support_message_returns_400_when_message_is_empty(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        session = await _register_and_login(client, "support-empty@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}

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
    async def test_support_message_still_completes_when_slack_delivery_fails(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        session = await _register_and_login(client, "support-failed@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(settings, "support_report_s3_bucket", "support-bucket")
        monkeypatch.setattr(
            settings,
            "support_slack_webhook_url",
            "https://hooks.slack.test/services/example",
        )

        records: list[dict[str, object]] = []

        async def fake_put_json_object(
            *,
            bucket: str,
            key: str,
            value: dict[str, object],
            region_name: str | None = None,
        ) -> None:
            records.append(value)

        async def fake_post_incoming_webhook(
            *,
            webhook_url: str,
            text: str,
            blocks: list[dict[str, object]] | None = None,
        ) -> None:
            from proliferate.integrations.slack.errors import SlackWebhookError

            raise SlackWebhookError("boom")

        monkeypatch.setattr(
            "proliferate.server.support.service.put_json_object",
            fake_put_json_object,
        )
        monkeypatch.setattr(
            "proliferate.server.support.notifications.post_incoming_webhook",
            fake_post_incoming_webhook,
        )

        response = await client.post(
            "/v1/support/messages",
            headers=headers,
            json={"message": "Need help."},
        )

        assert response.status_code == 200
        assert response.json() == {"ok": True}
        assert records[-1]["status"] == "completed"

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
            "proliferate.server.support.storage.presign_put_object",
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
    async def test_support_report_create_is_idempotent_and_splits_upload_targets(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        session = await _register_and_login(client, "support-report-create@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(settings, "support_report_s3_bucket", "support-bucket")
        monkeypatch.setattr(settings, "support_report_s3_region", "us-west-2")

        records: list[dict[str, object]] = []

        async def fake_put_json_object(
            *,
            bucket: str,
            key: str,
            value: dict[str, object],
            region_name: str | None = None,
        ) -> None:
            assert bucket == "support-bucket"
            assert region_name == "us-west-2"
            assert key.endswith("/request.json")
            records.append(value)

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

        monkeypatch.setattr(
            "proliferate.server.support.service.put_json_object",
            fake_put_json_object,
        )
        monkeypatch.setattr(
            "proliferate.server.support.storage.presign_put_object",
            fake_presign_put_object,
        )

        create_body = {
            "clientJobId": "support-job-1",
            "message": "The app got stuck.",
            "sourceSurface": "desktop",
            "context": {"source": "sidebar", "pathname": "/workspace/cloud:abc?secret=nope"},
            "scope": {"kind": "app_only", "workspaceIds": []},
            "workspaceRefs": [],
            "expectedClientUploads": {"diagnostics": True, "attachmentCount": 1},
            "publicContentConsent": True,
        }
        first = await client.post("/v1/support/reports", headers=headers, json=create_body)
        second = await client.post("/v1/support/reports", headers=headers, json=create_body)

        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()["reportId"] == second.json()["reportId"]
        assert first.json()["serverCorrelation"]["ownerUserId"] == session["user_id"]
        assert first.json()["serverCorrelation"]["primaryTenantId"] == f"user:{session['user_id']}"
        assert len(records) == 1
        assert records[0]["schemaVersion"] == 2
        assert records[0]["publicContentConsent"] is True
        assert records[0]["expectedClientUploads"] == {
            "diagnostics": True,
            "attachmentCount": 1,
        }
        assert "putUrl" not in json.dumps(records[0])
        context_record = records[0]["context"]
        assert isinstance(context_record, dict)
        assert context_record["pathname"] == "/workspace/{id}"

        upload_targets = await client.post(
            f"/v1/support/reports/{first.json()['reportId']}/upload-targets",
            headers=headers,
            json={
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

        assert upload_targets.status_code == 200
        payload = upload_targets.json()
        assert payload["reportId"] == first.json()["reportId"]
        assert payload["diagnostics"]["putUrl"].startswith("https://s3.test/")
        assert payload["attachments"][0]["clientFileId"] == "file-1"

        changed_upload_targets = await client.post(
            f"/v1/support/reports/{first.json()['reportId']}/upload-targets",
            headers=headers,
            json={
                "diagnostics": {
                    "contentType": "application/json",
                    "sizeBytes": 1024,
                    "sha256": "changed",
                },
                "attachments": [],
            },
        )

        assert changed_upload_targets.status_code == 400
        assert changed_upload_targets.json()["detail"]["code"] == "support_report_upload_invalid"

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
                        {"objectKey": ("support/reports/report123/attachments/file-1/screen.png")}
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
                "ContentLength": 512 if key.endswith("diagnostics.json") else 100,
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
            "proliferate.server.support.service.get_json_object", fake_get_json_object
        )
        monkeypatch.setattr("proliferate.server.support.storage.head_object", fake_head_object)
        monkeypatch.setattr(
            "proliferate.server.support.service.put_json_object", fake_put_json_object
        )
        monkeypatch.setattr(
            "proliferate.server.support.notifications.post_incoming_webhook",
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

    @pytest.mark.asyncio
    async def test_support_report_tracker_creates_github_and_linear_links(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        session = await _register_and_login(client, "support-tracker@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(settings, "support_report_s3_bucket", "support-bucket")
        monkeypatch.setattr(settings, "support_tracker_enabled", True)
        monkeypatch.setattr(settings, "support_github_app_id", "1")
        monkeypatch.setattr(settings, "support_github_app_private_key", "private-key")
        monkeypatch.setattr(settings, "support_github_app_installation_id", "2")
        monkeypatch.setattr(settings, "support_github_owner", "proliferate-ai")
        monkeypatch.setattr(settings, "support_github_repo", "proliferate")
        monkeypatch.setattr(settings, "support_linear_api_key", "lin_api")
        monkeypatch.setattr(settings, "support_linear_team_id", "team-1")

        s3_records: dict[str, dict[str, object]] = {}

        async def fake_put_json_object(
            *,
            bucket: str,
            key: str,
            value: dict[str, object],
            region_name: str | None = None,
        ) -> None:
            assert bucket == "support-bucket"
            s3_records[key] = value

        async def fake_get_json_object(
            *,
            bucket: str,
            key: str,
            region_name: str | None = None,
        ) -> dict[str, object]:
            assert bucket == "support-bucket"
            return s3_records[key]

        async def fake_schedule_tracker_after_commit(
            db: AsyncSession,
            report_id: str,
        ) -> None:
            return None

        async def fake_github_issue(**kwargs: object) -> GitHubIssue:
            body = str(kwargs["body"])
            assert "The app got stuck." in body
            assert "Internal diagnostics are stored" in body
            return GitHubIssue(
                id="github-issue-1",
                number=123,
                url="https://github.com/proliferate-ai/proliferate/issues/123",
                body=body,
            )

        async def fake_linear_issue(**kwargs: object) -> LinearIssue:
            description = str(kwargs["description"])
            assert "https://github.com/proliferate-ai/proliferate/issues/123" in description
            return LinearIssue(
                id="linear-issue-1",
                identifier="SUP-123",
                url="https://linear.app/proliferate/issue/SUP-123",
                description=description,
            )

        monkeypatch.setattr(
            "proliferate.server.support.service.put_json_object",
            fake_put_json_object,
        )
        monkeypatch.setattr(
            "proliferate.server.support.tracker.get_json_object",
            fake_get_json_object,
        )
        monkeypatch.setattr(
            "proliferate.server.support.tracker.put_json_object",
            fake_put_json_object,
        )
        monkeypatch.setattr(
            "proliferate.server.support.service.schedule_support_tracker_after_commit",
            fake_schedule_tracker_after_commit,
        )
        monkeypatch.setattr(
            "proliferate.server.support.tracker.github_issues.ensure_support_issue",
            fake_github_issue,
        )
        monkeypatch.setattr(
            "proliferate.server.support.tracker.ensure_linear_support_issue",
            fake_linear_issue,
        )

        create = await client.post(
            "/v1/support/reports",
            headers=headers,
            json={
                "clientJobId": "support-job-tracker",
                "message": "The app got stuck.",
                "sourceSurface": "web",
                "scope": {"kind": "app_only", "workspaceIds": []},
                "expectedClientUploads": {"diagnostics": False, "attachmentCount": 0},
                "publicContentConsent": True,
            },
        )
        assert create.status_code == 200
        report_id = create.json()["reportId"]

        complete = await client.post(
            f"/v1/support/reports/{report_id}/complete",
            headers=headers,
            json={"attachments": [], "packageManifest": {"schemaVersion": 1}},
        )
        assert complete.status_code == 200

        processed = await run_support_tracker_reconcile_pass(report_id=report_id, limit=1)
        assert processed == 1

        report = await support_reports.get_report_by_id(db_session, report_id)
        assert report is not None
        assert report.tracker_status == "completed"
        assert report.github_issue_url == "https://github.com/proliferate-ai/proliferate/issues/123"
        assert report.linear_issue_url == "https://linear.app/proliferate/issue/SUP-123"
        tracker_records = [
            value for key, value in s3_records.items() if key.endswith("/tracker.json")
        ]
        assert tracker_records[0]["trackerStatus"] == "completed"

    @pytest.mark.asyncio
    async def test_support_report_tracker_omits_message_from_public_issue_without_consent(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        session = await _register_and_login(client, "support-tracker-private@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(settings, "support_report_s3_bucket", "support-bucket")
        monkeypatch.setattr(settings, "support_tracker_enabled", True)
        monkeypatch.setattr(settings, "support_github_app_id", "1")
        monkeypatch.setattr(settings, "support_github_app_private_key", "private-key")
        monkeypatch.setattr(settings, "support_github_app_installation_id", "2")
        monkeypatch.setattr(settings, "support_github_owner", "proliferate-ai")
        monkeypatch.setattr(settings, "support_github_repo", "proliferate")
        monkeypatch.setattr(settings, "support_github_label_support", "support issue")
        monkeypatch.setattr(settings, "support_github_label_private", "private")

        s3_records: dict[str, dict[str, object]] = {}

        async def fake_put_json_object(
            *,
            bucket: str,
            key: str,
            value: dict[str, object],
            region_name: str | None = None,
        ) -> None:
            assert bucket == "support-bucket"
            s3_records[key] = value

        async def fake_get_json_object(
            *,
            bucket: str,
            key: str,
            region_name: str | None = None,
        ) -> dict[str, object]:
            assert bucket == "support-bucket"
            return s3_records[key]

        async def fake_schedule_tracker_after_commit(
            db: AsyncSession,
            report_id: str,
        ) -> None:
            return None

        async def fake_github_issue(**kwargs: object) -> GitHubIssue:
            title = str(kwargs["title"])
            body = str(kwargs["body"])
            labels = tuple(kwargs["labels"])
            assert "Sensitive customer text" not in title
            assert "Sensitive customer text" not in body
            assert "Support report" in title
            assert "did not opt in" in body
            assert labels == ("support issue", "private")
            return GitHubIssue(
                id="github-private-1",
                number=456,
                url="https://github.com/proliferate-ai/proliferate/issues/456",
                body=body,
            )

        monkeypatch.setattr(
            "proliferate.server.support.service.put_json_object",
            fake_put_json_object,
        )
        monkeypatch.setattr(
            "proliferate.server.support.tracker.get_json_object",
            fake_get_json_object,
        )
        monkeypatch.setattr(
            "proliferate.server.support.tracker.put_json_object",
            fake_put_json_object,
        )
        monkeypatch.setattr(
            "proliferate.server.support.service.schedule_support_tracker_after_commit",
            fake_schedule_tracker_after_commit,
        )
        monkeypatch.setattr(
            "proliferate.server.support.tracker.github_issues.ensure_support_issue",
            fake_github_issue,
        )

        create = await client.post(
            "/v1/support/reports",
            headers=headers,
            json={
                "clientJobId": "support-job-tracker-private",
                "message": "Sensitive customer text with token abc123.",
                "sourceSurface": "web",
                "scope": {"kind": "app_only", "workspaceIds": []},
                "expectedClientUploads": {"diagnostics": False, "attachmentCount": 0},
                "publicContentConsent": False,
            },
        )
        assert create.status_code == 200
        report_id = create.json()["reportId"]

        complete = await client.post(
            f"/v1/support/reports/{report_id}/complete",
            headers=headers,
            json={"attachments": [], "packageManifest": {"schemaVersion": 1}},
        )
        assert complete.status_code == 200

        processed = await run_support_tracker_reconcile_pass(report_id=report_id, limit=1)
        assert processed == 1

        report = await support_reports.get_report_by_id(db_session, report_id)
        assert report is not None
        assert report.github_issue_url == "https://github.com/proliferate-ai/proliferate/issues/456"
