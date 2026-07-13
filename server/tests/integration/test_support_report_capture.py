"""Capture-time behavior for client release, summary, and telemetry refs."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.auth import User
from proliferate.db.store import support_reports
from proliferate.server.support import service
from proliferate.server.support.errors import SupportReportUploadInvalid
from proliferate.server.support.models import (
    SupportReportCompleteRequest,
    SupportReportCreateRequest,
)


@pytest.fixture(autouse=True)
def _storage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "support_report_s3_bucket", "private-support-bucket")
    monkeypatch.setattr(settings, "support_report_s3_region", "")

    async def _fake_put_json_object(**_: object) -> None:
        return None

    monkeypatch.setattr(service, "put_json_object", _fake_put_json_object)


async def _user(db: AsyncSession) -> User:
    user = User(
        id=uuid4(),
        email=f"{uuid4().hex}@example.com",
        hashed_password="x",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


def _create_body(**overrides: object) -> SupportReportCreateRequest:
    payload: dict[str, object] = {
        "clientJobId": uuid4().hex,
        "message": "Login  broke.  token=super-secret",
        "sourceSurface": "web",
        "scope": {"kind": "app_only", "workspaceIds": []},
        "expectedClientUploads": {"diagnostics": False, "attachmentCount": 0},
    }
    payload.update(overrides)
    return SupportReportCreateRequest.model_validate(payload)


async def test_create_stores_canonical_release_summary_and_refs(
    db_session: AsyncSession,
) -> None:
    user = await _user(db_session)
    response = await service.create_support_report(
        db=db_session,
        sender_user_id=user.id,
        sender_email=user.email,
        sender_display_name=None,
        body=_create_body(
            clientReleaseId="proliferate-web@0.3.26+9affc0f0d489",
            telemetryRefs={
                "sentryEvents": [{"project": "proliferate-web", "eventId": "e1"}],
                "sentryEventIds": ["e1", "e2"],
            },
        ),
    )

    stored = await support_reports.get_report_by_id(db_session, response.report_id)
    assert stored is not None
    assert stored.client_release_id == "proliferate-web@0.3.26+9affc0f0d489"
    assert stored.tracker_summary is not None
    assert "super-secret" not in stored.tracker_summary
    assert stored.telemetry_refs["sentryEvents"] == [
        {"project": "proliferate-web", "eventId": "e1"}
    ]
    assert stored.telemetry_refs["sentryEventIds"] == ["e2"]


async def test_create_nulls_malformed_release(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    response = await service.create_support_report(
        db=db_session,
        sender_user_id=user.id,
        sender_email=user.email,
        sender_display_name=None,
        body=_create_body(clientReleaseId="proliferate-cloud@bogus"),
    )
    stored = await support_reports.get_report_by_id(db_session, response.report_id)
    assert stored is not None
    assert stored.client_release_id is None


async def test_completion_enforcement_rejects_missing_release_when_enabled(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "support_report_require_client_release", True)
    user = await _user(db_session)
    response = await service.create_support_report(
        db=db_session,
        sender_user_id=user.id,
        sender_email=user.email,
        sender_display_name=None,
        body=_create_body(),  # no clientReleaseId
    )
    with pytest.raises(SupportReportUploadInvalid):
        await service.complete_support_report_upload(
            db=db_session,
            sender_user_id=user.id,
            sender_email=user.email,
            sender_display_name=None,
            report_id=response.report_id,
            body=SupportReportCompleteRequest(),
        )


async def test_completion_allows_missing_release_when_disabled(
    db_session: AsyncSession,
) -> None:
    # Dark by default: a legacy/absent release still completes.
    user = await _user(db_session)
    response = await service.create_support_report(
        db=db_session,
        sender_user_id=user.id,
        sender_email=user.email,
        sender_display_name=None,
        body=_create_body(),
    )
    result = await service.complete_support_report_upload(
        db=db_session,
        sender_user_id=user.id,
        sender_email=user.email,
        sender_display_name=None,
        report_id=response.report_id,
        body=SupportReportCompleteRequest(),
    )
    assert result.report_id == response.report_id
    stored = await support_reports.get_report_by_id(db_session, response.report_id)
    assert stored is not None
    assert stored.status == "completed"
