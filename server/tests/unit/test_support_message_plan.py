"""Customer-loop receipt contract (specs/engineering/customer-loop, §9).

The Slack receipt must be one step from triage: release id, bound session ids,
Sentry pairs, the Sentry query, and a prefilled file-an-issue link — and never
S3 keys, presigned URLs, or the report body. Absent sources are absent, not
blank.
"""

from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

from proliferate.server.support.domain.message import (
    SUPPORT_ISSUE_TEMPLATE,
    build_support_issue_url,
    build_support_report_plan,
)


def _plan(**overrides: object):
    kwargs: dict[str, object] = {
        "sender_name": "Support Tester",
        "sender_email": "support@example.com",
        "message": "Chat froze after the second turn.",
        "report_id": "report_123",
        "internal_url": None,
        "diagnostics_included": True,
        "attachment_count": 1,
    }
    kwargs.update(overrides)
    return build_support_report_plan(**kwargs)  # type: ignore[arg-type]


def test_receipt_carries_join_keys_when_present() -> None:
    plan = _plan(
        client_release_id="desktop-1.4.2",
        session_ids=["sess_a", "sess_b"],
        sentry_events=[
            {"project": "server", "eventId": "abc123"},
            {"project": "desktop", "eventId": "def456"},
            {"project": "broken"},  # missing eventId → dropped
        ],
        summary="Chat froze after the second turn.",
    )
    field_map = {field.label: field.value for field in plan.fields}

    assert field_map["Release"] == "desktop-1.4.2"
    assert field_map["Sessions"] == "sess_a, sess_b"
    assert field_map["Sentry"] == "server:abc123, desktop:def456"
    assert field_map["Sentry query"] == "support_report_id:report_123"

    url = urlsplit(field_map["File issue"])
    assert url.netloc == "github.com"
    assert url.path == "/proliferate-ai/proliferate/issues/new"
    query = parse_qs(url.query)
    assert query["template"] == [SUPPORT_ISSUE_TEMPLATE]
    assert query["report_id"] == ["report_123"]
    assert query["release"] == ["desktop-1.4.2"]
    assert query["sessions"] == ["sess_a, sess_b"]
    assert query["sentry_query"] == ["support_report_id:report_123"]
    assert query["summary"] == ["Chat froze after the second turn."]
    assert query["kind"] == ["bug"]
    assert query["urgent"] == ["no"]


def test_receipt_omits_absent_sources_rather_than_blanking_them() -> None:
    plan = _plan()
    labels = [field.label for field in plan.fields]

    assert "Release" not in labels
    assert "Sessions" not in labels
    assert "Sentry" not in labels
    # The query and the issue link only need the report id, so they are always present.
    assert "Sentry query" in labels
    query = parse_qs(urlsplit(dict((f.label, f.value) for f in plan.fields)["File issue"]).query)
    assert "release" not in query
    assert "sessions" not in query
    assert "summary" not in query


def test_receipt_caps_lists_at_five() -> None:
    plan = _plan(session_ids=[f"sess_{i}" for i in range(7)])
    field_map = {field.label: field.value for field in plan.fields}

    assert field_map["Sessions"] == "sess_0, sess_1, sess_2, sess_3, sess_4, +2 more"
    query = parse_qs(urlsplit(field_map["File issue"]).query)
    assert query["sessions"] == ["sess_0, sess_1, sess_2, sess_3, sess_4"]


def test_issue_url_reflects_kind_and_urgency() -> None:
    url = build_support_issue_url(report_id="report_9", kind="feature", urgent=True)
    query = parse_qs(urlsplit(url).query)

    assert query["kind"] == ["feature"]
    assert query["urgent"] == ["yes"]
    assert query["title"] == ["[Support]: report_9"]


def test_receipt_never_leaks_storage_pointers_or_body() -> None:
    body = "Full private report body that must stay out of the receipt fields."
    plan = _plan(
        message=body,
        context={"source": "chat", "s3_prefix": "support/report_123"},
        correlation={"primaryTenantId": "tenant_1"},
        summary="Redacted summary.",
    )
    rendered = " ".join(f"{field.label}={field.value}" for field in plan.fields)

    assert "support/report_123" not in rendered
    assert "presigned" not in rendered.lower()
    assert body not in rendered
    assert "X-Amz" not in rendered
