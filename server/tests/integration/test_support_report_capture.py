"""Capture-time behavior for client release, summary, and telemetry refs."""

from __future__ import annotations

import logging
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.auth import User
from proliferate.db.store import support_reports
from proliferate.integrations.slack.errors import SlackWebhookError
from proliferate.server.support import notifications as support_notifications
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
    monkeypatch.setattr(settings, "support_slack_webhook_url", "")
    monkeypatch.setattr(logging.getLogger("proliferate"), "propagate", True)
    monkeypatch.setattr(
        logging.getLogger(support_notifications.__name__),
        "disabled",
        False,
    )

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


async def test_create_records_whether_client_provided_a_release(
    db_session: AsyncSession,
) -> None:
    user = await _user(db_session)
    # Legacy client: field never sent.
    absent = await service.create_support_report(
        db=db_session,
        sender_user_id=user.id,
        sender_email=user.email,
        sender_display_name=None,
        body=_create_body(),
    )
    # New client: sent a value that fails canonical validation.
    malformed = await service.create_support_report(
        db=db_session,
        sender_user_id=user.id,
        sender_email=user.email,
        sender_display_name=None,
        body=_create_body(clientReleaseId="proliferate-cloud@bogus"),
    )
    stored_absent = await support_reports.get_report_by_id(db_session, absent.report_id)
    stored_malformed = await support_reports.get_report_by_id(db_session, malformed.report_id)
    assert stored_absent is not None and stored_malformed is not None
    assert stored_absent.client_release_provided is False
    assert stored_absent.client_release_id is None
    assert stored_malformed.client_release_provided is True
    assert stored_malformed.client_release_id is None


async def _create_and_complete(
    db_session: AsyncSession,
    user: User,
    **create_overrides: object,
) -> str:
    response = await service.create_support_report(
        db=db_session,
        sender_user_id=user.id,
        sender_email=user.email,
        sender_display_name=None,
        body=_create_body(**create_overrides),
    )
    await service.complete_support_report_upload(
        db=db_session,
        sender_user_id=user.id,
        sender_email=user.email,
        sender_display_name=None,
        report_id=response.report_id,
        body=SupportReportCompleteRequest(),
    )
    return response.report_id


async def _complete_report(
    db_session: AsyncSession,
    user: User,
    report_id: str,
) -> None:
    response = await service.complete_support_report_upload(
        db=db_session,
        sender_user_id=user.id,
        sender_email=user.email,
        sender_display_name=None,
        report_id=report_id,
        body=SupportReportCompleteRequest(),
    )
    assert response.report_id == report_id


async def test_completion_records_slack_receipt_after_delivery_succeeds(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await _user(db_session)
    created = await service.create_support_report(
        db=db_session,
        sender_user_id=user.id,
        sender_email=user.email,
        sender_display_name=None,
        body=_create_body(),
    )
    calls: list[str] = []

    async def _fake_post_incoming_webhook(
        *,
        webhook_url: str,
        text: str,
        blocks: list[dict[str, object]] | None = None,
    ) -> None:
        del text, blocks
        calls.append(webhook_url)
        stored_before_success = await support_reports.get_report_by_id(
            db_session, created.report_id
        )
        assert stored_before_success is not None
        assert stored_before_success.status == "completed"
        assert stored_before_success.slack_notified_at is None

    monkeypatch.setattr(settings, "support_slack_webhook_url", "https://slack.test/report")
    monkeypatch.setattr(
        support_notifications,
        "post_incoming_webhook",
        _fake_post_incoming_webhook,
    )

    await _complete_report(db_session, user, created.report_id)
    stored = await support_reports.get_report_by_id(db_session, created.report_id)
    assert stored is not None
    assert stored.status == "completed"
    assert stored.slack_notified_at is not None
    first_receipt = stored.slack_notified_at
    assert calls == ["https://slack.test/report"]

    await _complete_report(db_session, user, created.report_id)
    stored_after_duplicate = await support_reports.get_report_by_id(db_session, created.report_id)
    assert stored_after_duplicate is not None
    assert stored_after_duplicate.slack_notified_at == first_receipt
    assert calls == ["https://slack.test/report"]


async def test_completion_leaves_slack_receipt_null_when_webhook_is_missing(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    user = await _user(db_session)
    created = await service.create_support_report(
        db=db_session,
        sender_user_id=user.id,
        sender_email=user.email,
        sender_display_name=None,
        body=_create_body(),
    )
    calls: list[str] = []

    async def _fake_post_incoming_webhook(**_: object) -> None:
        calls.append("called")

    monkeypatch.setattr(settings, "support_slack_webhook_url", "  ")
    monkeypatch.setattr(
        support_notifications,
        "post_incoming_webhook",
        _fake_post_incoming_webhook,
    )

    with caplog.at_level(logging.ERROR, logger=support_notifications.__name__):
        await _complete_report(db_session, user, created.report_id)
        await _complete_report(db_session, user, created.report_id)

    stored = await support_reports.get_report_by_id(db_session, created.report_id)
    assert stored is not None
    assert stored.status == "completed"
    assert stored.slack_notified_at is None
    assert calls == []
    records = [
        record for record in caplog.records if record.name == support_notifications.__name__
    ]
    assert len(records) == 1
    assert records[0].levelno == logging.ERROR
    assert records[0].getMessage() == (
        f"Support report {created.report_id} completed but SUPPORT_SLACK_WEBHOOK_URL "
        "is unset — no Slack notification sent. Set the webhook secret in this environment."
    )


async def test_completion_leaves_slack_receipt_null_when_delivery_fails(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    user = await _user(db_session)
    created = await service.create_support_report(
        db=db_session,
        sender_user_id=user.id,
        sender_email=user.email,
        sender_display_name=None,
        body=_create_body(),
    )
    calls: list[str] = []

    async def _fake_post_incoming_webhook(
        *,
        webhook_url: str,
        text: str,
        blocks: list[dict[str, object]] | None = None,
    ) -> None:
        del text, blocks
        calls.append(webhook_url)
        raise SlackWebhookError("provider unavailable")

    monkeypatch.setattr(settings, "support_slack_webhook_url", "https://slack.test/report")
    monkeypatch.setattr(
        support_notifications,
        "post_incoming_webhook",
        _fake_post_incoming_webhook,
    )

    with caplog.at_level(logging.ERROR, logger=support_notifications.__name__):
        await _complete_report(db_session, user, created.report_id)
        await _complete_report(db_session, user, created.report_id)

    stored = await support_reports.get_report_by_id(db_session, created.report_id)
    assert stored is not None
    assert stored.status == "completed"
    assert stored.slack_notified_at is None
    assert calls == ["https://slack.test/report"]
    records = [
        record for record in caplog.records if record.name == support_notifications.__name__
    ]
    assert len(records) == 1
    assert records[0].levelno == logging.ERROR
    assert records[0].getMessage() == (
        f"Support report {created.report_id} Slack notification failed to deliver: "
        "provider unavailable"
    )


async def test_enforcement_accepts_legacy_absent_release(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Flag ON: an old client that never sent the field still completes (it
    # stays feedable with a visible releaseWarning). This is the long tail of
    # never-updated desktop installs; enforcement must not break them.
    monkeypatch.setattr(settings, "support_report_require_client_release", True)
    user = await _user(db_session)
    report_id = await _create_and_complete(db_session, user)
    stored = await support_reports.get_report_by_id(db_session, report_id)
    assert stored is not None
    assert stored.status == "completed"
    assert stored.client_release_id is None
    assert stored.client_release_provided is False


async def test_enforcement_rejects_provided_malformed_release(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Flag ON: a client that PROVIDED a value which failed validation is a new
    # client declaring the schema — reject its completion.
    monkeypatch.setattr(settings, "support_report_require_client_release", True)
    user = await _user(db_session)
    response = await service.create_support_report(
        db=db_session,
        sender_user_id=user.id,
        sender_email=user.email,
        sender_display_name=None,
        body=_create_body(clientReleaseId="proliferate-web@not a release"),
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


async def test_enforcement_accepts_provided_valid_release(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Flag ON: a canonical provided release completes normally.
    monkeypatch.setattr(settings, "support_report_require_client_release", True)
    user = await _user(db_session)
    report_id = await _create_and_complete(
        db_session,
        user,
        clientReleaseId="proliferate-web@0.3.27+9affc0f0d489",
    )
    stored = await support_reports.get_report_by_id(db_session, report_id)
    assert stored is not None
    assert stored.status == "completed"
    assert stored.client_release_id == "proliferate-web@0.3.27+9affc0f0d489"
    assert stored.client_release_provided is True


async def test_completion_allows_malformed_release_when_disabled(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Flag OFF (the default): even a provided-malformed release completes; the
    # row stays feedable with a warning. Enablement is an explicit ops flip.
    monkeypatch.setattr(settings, "support_report_require_client_release", False)
    user = await _user(db_session)
    report_id = await _create_and_complete(
        db_session,
        user,
        clientReleaseId="proliferate-cloud@bogus",
    )
    stored = await support_reports.get_report_by_id(db_session, report_id)
    assert stored is not None
    assert stored.status == "completed"
    assert stored.client_release_id is None
    assert stored.client_release_provided is True
