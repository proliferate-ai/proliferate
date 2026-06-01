"""Support notification delivery."""

from __future__ import annotations

import logging

from proliferate.config import settings
from proliferate.integrations.slack.errors import SlackWebhookError
from proliferate.integrations.slack.messages import (
    SlackMessageField,
    build_mrkdwn_message_blocks,
)
from proliferate.integrations.slack.webhooks import post_incoming_webhook
from proliferate.middleware.request_context import get_request_id
from proliferate.server.support.domain.message import (
    build_support_message_plan,
    build_support_report_plan,
    build_support_tracker_plan,
    normalize_support_message,
)
from proliferate.server.support.errors import (
    SupportDeliveryFailed,
    SupportMessageEmpty,
    SupportUnavailable,
)

logger = logging.getLogger(__name__)


async def send_support_message_notification(
    *,
    sender_email: str,
    sender_display_name: str | None,
    message: str,
    context: dict[str, object] | None = None,
) -> None:
    webhook_url = settings.support_slack_webhook_url.strip()
    if not webhook_url:
        raise SupportUnavailable()

    cleaned_message = normalize_support_message(message)
    if not cleaned_message:
        raise SupportMessageEmpty()

    plan = build_support_message_plan(
        sender_name=sender_display_name or sender_email,
        sender_email=sender_email,
        message=cleaned_message,
        context=context,
        request_id=get_request_id(),
    )
    blocks = build_mrkdwn_message_blocks(
        title="*New support message*",
        body=plan.message,
        fields=tuple(SlackMessageField(field.label, field.value) for field in plan.fields),
    )

    try:
        await post_incoming_webhook(
            webhook_url=webhook_url,
            text=plan.fallback_text,
            blocks=blocks,
        )
    except SlackWebhookError as exc:
        raise SupportDeliveryFailed() from exc


async def notify_support_report(
    *,
    sender_email: str,
    sender_display_name: str | None,
    report_id: str,
    message: str,
    context: dict[str, object] | None,
    diagnostics_included: bool,
    attachment_count: int,
    correlation: dict[str, object] | None,
) -> None:
    webhook_url = settings.support_slack_webhook_url.strip()
    if not webhook_url:
        return

    plan = build_support_report_plan(
        sender_name=sender_display_name or sender_email,
        sender_email=sender_email,
        message=normalize_support_message(message) or "Support report submitted.",
        report_id=report_id,
        internal_url=_support_report_internal_url(report_id),
        diagnostics_included=diagnostics_included,
        attachment_count=attachment_count,
        context=context,
        correlation=correlation,
        request_id=get_request_id(),
    )
    blocks = build_mrkdwn_message_blocks(
        title="*New support report*",
        body=plan.message,
        fields=tuple(SlackMessageField(field.label, field.value) for field in plan.fields),
    )

    try:
        await post_incoming_webhook(
            webhook_url=webhook_url,
            text=plan.fallback_text,
            blocks=blocks,
        )
    except SlackWebhookError as exc:
        logger.warning("Support report Slack notification failed: %s", exc)


async def notify_support_report_tracker(
    *,
    report_id: str,
    github_issue_url: str | None,
    linear_issue_url: str | None,
) -> bool:
    webhook_url = settings.support_slack_webhook_url.strip()
    if not webhook_url:
        return False

    plan = build_support_tracker_plan(
        report_id=report_id,
        github_issue_url=github_issue_url,
        linear_issue_url=linear_issue_url,
        internal_url=_support_report_internal_url(report_id),
    )
    blocks = build_mrkdwn_message_blocks(
        title="*Support report tracker ready*",
        body=plan.message,
        fields=tuple(SlackMessageField(field.label, field.value) for field in plan.fields),
    )
    try:
        await post_incoming_webhook(
            webhook_url=webhook_url,
            text=plan.fallback_text,
            blocks=blocks,
        )
    except SlackWebhookError as exc:
        logger.warning("Support tracker Slack notification failed: %s", exc)
        return False
    return True


def _support_report_internal_url(report_id: str) -> str | None:
    base_url = settings.support_report_internal_base_url.strip().rstrip("/")
    return f"{base_url}/{report_id}" if base_url else None
