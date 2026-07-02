import asyncio
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.store import support_reports
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
    async def test_support_tracker_duplicate_pass_skips_leased_report(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        session = await _register_and_login(client, "support-tracker-duplicate@example.com")
        monkeypatch.setattr(settings, "support_tracker_enabled", True)
        report_id = "support-report-duplicate"
        await support_reports.create_report(
            db_session,
            report_id=report_id,
            client_job_id="support-job-duplicate",
            owner_user_id=UUID(session["user_id"]),
            primary_organization_id=None,
            primary_tenant_id=f"user:{session['user_id']}",
            tenant_ids=(f"user:{session['user_id']}",),
            s3_bucket="support-bucket",
            s3_prefix="support/report-duplicate",
            source_surface="web",
            source_context={},
            workspace_refs=(),
            telemetry_refs={},
            expected_uploads={"diagnostics": False, "attachmentCount": 0},
            public_content_consent=True,
            request_id=None,
            cloud_diagnostics_status="not_applicable",
        )
        await support_reports.mark_report_completed(
            db_session,
            report_id=report_id,
            complete_request_id=None,
            object_manifest={"schemaVersion": 1},
            tracker_status="pending",
            github_status="pending",
            linear_status="disabled",
            crosslink_status="disabled",
        )
        await db_session.commit()

        started = asyncio.Event()
        release = asyncio.Event()
        processed_ids: list[str] = []

        async def _hold_claimed_report(report: support_reports.SupportReportSnapshot) -> None:
            processed_ids.append(report.id)
            started.set()
            await release.wait()

        monkeypatch.setattr(
            "proliferate.server.support.tracker._process_claimed_report",
            _hold_claimed_report,
        )

        first = asyncio.create_task(run_support_tracker_reconcile_pass(limit=1))
        try:
            await asyncio.wait_for(started.wait(), timeout=2.0)
            assert await run_support_tracker_reconcile_pass(limit=1) == 0
        finally:
            release.set()
        assert await first == 1
        assert processed_ids == [report_id]
        await db_session.rollback()
        report = await support_reports.get_report_by_id(db_session, report_id)
        assert report is not None
        assert report.tracker_attempt_count == 1
