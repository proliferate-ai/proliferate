from __future__ import annotations

from proliferate.server.support.domain.message import (
    build_support_message_plan,
    normalize_support_message,
)


def test_normalize_support_message_trims_content() -> None:
    assert normalize_support_message("  Need help.  ") == "Need help."


def test_normalize_support_message_rejects_blank_content() -> None:
    assert normalize_support_message("   ") is None


def test_build_support_message_plan_includes_sender_context_and_request_id() -> None:
    plan = build_support_message_plan(
        sender_name="Support Tester",
        sender_email="support@example.com",
        message="Need help.",
        context={
            "source": "sidebar",
            "intent": "general",
            "pathname": "/chat",
            "workspace_name": "acme/api",
            "workspace_location": "cloud",
            "workspace_id": "cloud:123",
        },
        request_id="req_123",
    )

    assert plan.message == "Need help."
    assert plan.fallback_text == "Support message from Support Tester: Need help."
    assert [(field.label, field.value) for field in plan.fields] == [
        ("From", "Support Tester"),
        ("Email", "support@example.com"),
        ("Source", "sidebar"),
        ("Intent", "general"),
        ("Page", "/chat"),
        ("Workspace", "cloud · acme/api"),
        ("Workspace ID", "cloud:123"),
        ("Request ID", "req_123"),
    ]


def test_build_support_message_plan_uses_location_without_workspace_name() -> None:
    plan = build_support_message_plan(
        sender_name="Support Tester",
        sender_email="support@example.com",
        message="Need help.",
        context={"workspace_location": "local"},
    )

    assert ("Workspace", "local") in [
        (field.label, field.value)
        for field in plan.fields
    ]
