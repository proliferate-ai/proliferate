from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.store import support_reports
from proliferate.integrations.github.issues import GitHubIssue
from proliferate.integrations.linear import LinearIssue
from proliferate.server.support.tracker import run_support_tracker_reconcile_pass
from tests.helpers.desktop_auth import mint_desktop_token_payload


async def _register_and_login(client: AsyncClient, email: str) -> dict[str, str]:
    from proliferate.auth.models import UserCreate
    from proliferate.auth.users import UserManager, get_user_db
    from proliferate.db.engine import get_async_session

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


class TestSupportTrackerApi:
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
        monkeypatch.setattr(settings, "support_linear_label_ids", "triage-label")
        monkeypatch.setattr(settings, "support_linear_private_details_label_id", "private-label")

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
            label_ids = tuple(kwargs["label_ids"])
            assert "https://github.com/proliferate-ai/proliferate/issues/123" in description
            assert label_ids == ("triage-label",)
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

        db_session.expire_all()
        report = await support_reports.get_report_by_id(db_session, report_id)
        assert report is not None
        assert report.tracker_status == "completed"
        assert (
            report.github_issue_url == "https://github.com/proliferate-ai/proliferate/issues/123"
        )
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
        monkeypatch.setattr(settings, "support_linear_api_key", "lin_api")
        monkeypatch.setattr(settings, "support_linear_team_id", "team-1")
        monkeypatch.setattr(settings, "support_linear_private_details_label_id", "private-label")

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

        async def fake_linear_issue(**kwargs: object) -> LinearIssue:
            description = str(kwargs["description"])
            label_ids = tuple(kwargs["label_ids"])
            assert "Sensitive customer text" not in description
            assert "did not opt in" in description
            assert label_ids == ("private-label",)
            return LinearIssue(
                id="linear-private-1",
                identifier="SUP-456",
                url="https://linear.app/proliferate/issue/SUP-456",
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

        db_session.expire_all()
        report = await support_reports.get_report_by_id(db_session, report_id)
        assert report is not None
        assert (
            report.github_issue_url == "https://github.com/proliferate-ai/proliferate/issues/456"
        )
        assert report.linear_issue_url == "https://linear.app/proliferate/issue/SUP-456"

    @pytest.mark.asyncio
    async def test_targeted_tracker_reconcile_claims_legacy_none_report(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        session = await _register_and_login(client, "support-tracker-legacy@example.com")
        monkeypatch.setattr(settings, "support_tracker_enabled", True)
        monkeypatch.setattr(settings, "support_github_app_id", "1")
        monkeypatch.setattr(settings, "support_github_app_private_key", "private-key")
        monkeypatch.setattr(settings, "support_github_app_installation_id", "2")
        monkeypatch.setattr(settings, "support_github_owner", "proliferate-ai")
        monkeypatch.setattr(settings, "support_github_repo", "proliferate")
        monkeypatch.setattr(settings, "support_linear_api_key", "")
        monkeypatch.setattr(settings, "support_linear_team_id", "")

        report_id = "legacy-none-report"
        report_prefix = f"support/reports/2026/05/31/{report_id}"
        s3_records: dict[str, dict[str, object]] = {
            f"{report_prefix}/request.json": {
                "schemaVersion": 1,
                "reportId": report_id,
                "message": "Legacy customer message should stay private.",
                "sender": {"email": "support-tracker-legacy@example.com"},
            }
        }

        await support_reports.create_report(
            db_session,
            report_id=report_id,
            client_job_id="legacy-none-job",
            owner_user_id=UUID(session["user_id"]),
            primary_organization_id=None,
            primary_tenant_id=f"user:{session['user_id']}",
            tenant_ids=(f"user:{session['user_id']}",),
            s3_bucket="support-bucket",
            s3_prefix=report_prefix,
            source_surface="web",
            source_context={},
            workspace_refs=(),
            telemetry_refs={},
            expected_uploads={},
            public_content_consent=False,
            request_id=None,
            cloud_diagnostics_status="not_applicable",
        )
        await support_reports.mark_report_completed(
            db_session,
            report_id=report_id,
            complete_request_id=None,
            object_manifest={},
        )
        await db_session.commit()

        async def fake_get_json_object(
            *,
            bucket: str,
            key: str,
            region_name: str | None = None,
        ) -> dict[str, object]:
            assert bucket == "support-bucket"
            return s3_records[key]

        async def fake_put_json_object(
            *,
            bucket: str,
            key: str,
            value: dict[str, object],
            region_name: str | None = None,
        ) -> None:
            assert bucket == "support-bucket"
            s3_records[key] = value

        async def fake_github_issue(**kwargs: object) -> GitHubIssue:
            title = str(kwargs["title"])
            body = str(kwargs["body"])
            assert "Legacy customer message" not in title
            assert "Legacy customer message" not in body
            assert "did not opt in" in body
            return GitHubIssue(
                id="github-legacy-1",
                number=789,
                url="https://github.com/proliferate-ai/proliferate/issues/789",
                body=body,
            )

        async def fake_notify_support_report_tracker(**kwargs: object) -> bool:
            return False

        monkeypatch.setattr(
            "proliferate.server.support.tracker.get_json_object",
            fake_get_json_object,
        )
        monkeypatch.setattr(
            "proliferate.server.support.tracker.put_json_object",
            fake_put_json_object,
        )
        monkeypatch.setattr(
            "proliferate.server.support.tracker.github_issues.ensure_support_issue",
            fake_github_issue,
        )
        monkeypatch.setattr(
            "proliferate.server.support.tracker.notify_support_report_tracker",
            fake_notify_support_report_tracker,
        )

        processed = await run_support_tracker_reconcile_pass(report_id=report_id, limit=1)
        assert processed == 1

        db_session.expire_all()
        report = await support_reports.get_report_by_id(db_session, report_id)
        assert report is not None
        assert report.tracker_status == "completed"
        assert report.github_issue_number == 789
        assert report.linear_status == "disabled"
        tracker_record = s3_records[f"{report_prefix}/tracker.json"]
        assert tracker_record["trackerStatus"] == "completed"

    @pytest.mark.asyncio
    async def test_support_report_tracker_nudge_schedules_legacy_none_report(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        session = await _register_and_login(client, "support-tracker-nudge@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        monkeypatch.setattr(settings, "support_tracker_enabled", True)
        scheduled_report_ids: list[str] = []

        async def fake_schedule_tracker_after_commit(
            db: AsyncSession,
            report_id: str,
        ) -> None:
            scheduled_report_ids.append(report_id)

        monkeypatch.setattr(
            "proliferate.server.support.service.schedule_support_tracker_after_commit",
            fake_schedule_tracker_after_commit,
        )

        report_id = "legacy-none-nudge-report"
        await support_reports.create_report(
            db_session,
            report_id=report_id,
            client_job_id="legacy-none-nudge-job",
            owner_user_id=UUID(session["user_id"]),
            primary_organization_id=None,
            primary_tenant_id=f"user:{session['user_id']}",
            tenant_ids=(f"user:{session['user_id']}",),
            s3_bucket="support-bucket",
            s3_prefix=f"support/reports/2026/05/31/{report_id}",
            source_surface="web",
            source_context={},
            workspace_refs=(),
            telemetry_refs={},
            expected_uploads={},
            public_content_consent=False,
            request_id=None,
            cloud_diagnostics_status="not_applicable",
        )
        await support_reports.mark_report_completed(
            db_session,
            report_id=report_id,
            complete_request_id=None,
            object_manifest={},
        )
        await db_session.commit()

        response = await client.post(f"/v1/support/reports/{report_id}/tracker", headers=headers)
        assert response.status_code == 200
        assert scheduled_report_ids == [report_id]

    @pytest.mark.asyncio
    async def test_automatic_tracker_pass_does_not_claim_disabled_report(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        session = await _register_and_login(client, "support-tracker-disabled@example.com")
        monkeypatch.setattr(settings, "support_tracker_enabled", True)

        report_id = "legacy-disabled-report"
        await support_reports.create_report(
            db_session,
            report_id=report_id,
            client_job_id="legacy-disabled-job",
            owner_user_id=UUID(session["user_id"]),
            primary_organization_id=None,
            primary_tenant_id=f"user:{session['user_id']}",
            tenant_ids=(f"user:{session['user_id']}",),
            s3_bucket="support-bucket",
            s3_prefix=f"support/reports/2026/05/31/{report_id}",
            source_surface="web",
            source_context={},
            workspace_refs=(),
            telemetry_refs={},
            expected_uploads={},
            public_content_consent=False,
            request_id=None,
            cloud_diagnostics_status="not_applicable",
        )
        await support_reports.mark_report_completed(
            db_session,
            report_id=report_id,
            complete_request_id=None,
            object_manifest={},
            tracker_status="disabled",
            github_status="disabled",
            linear_status="disabled",
            crosslink_status="disabled",
        )
        await db_session.commit()

        processed = await run_support_tracker_reconcile_pass(limit=1)
        assert processed == 0

        db_session.expire_all()
        report = await support_reports.get_report_by_id(db_session, report_id)
        assert report is not None
        assert report.tracker_status == "disabled"
        assert report.tracker_attempt_count == 0
