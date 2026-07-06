from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

from proliferate.server.support.domain.report_records import support_request_record


def _fake_report(*, urgent: bool, notify_me: bool) -> SimpleNamespace:
    return SimpleNamespace(
        id="report_abc",
        client_job_id="job_abc",
        request_id="req_abc",
        created_at=datetime(2026, 7, 5, tzinfo=UTC),
        source_context={"source": "sidebar"},
        workspace_refs=(),
        telemetry_refs={},
        object_manifest={},
        expected_uploads={"diagnostics": True, "attachmentCount": 0},
        public_content_consent=False,
        urgent=urgent,
        notify_me=notify_me,
    )


def test_support_request_record_includes_urgent_and_notify_me() -> None:
    record = support_request_record(
        report=_fake_report(urgent=True, notify_me=True),
        sender_email="support@example.com",
        sender_display_name="Support Tester",
        message="  Prod is down.  ",
        scope={"kind": "app_only", "workspaceIds": []},
        correlation={"reportId": "report_abc"},
    )

    assert record["urgent"] is True
    assert record["notifyMe"] is True
    assert record["message"] == "Prod is down."


def test_support_request_record_defaults_capture_flags_false() -> None:
    record = support_request_record(
        report=_fake_report(urgent=False, notify_me=False),
        sender_email="support@example.com",
        sender_display_name=None,
        message="Question.",
        scope={"kind": "app_only", "workspaceIds": []},
        correlation={},
    )

    assert record["urgent"] is False
    assert record["notifyMe"] is False
