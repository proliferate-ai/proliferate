from __future__ import annotations

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
    normalize_support_message,
)
from proliferate.server.support.errors import (
    SupportDeliveryFailed,
    SupportMessageEmpty,
    SupportUnavailable,
)


async def send_support_message(
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
        fields=tuple(
            SlackMessageField(field.label, field.value)
            for field in plan.fields
        ),
    )

    try:
        await post_incoming_webhook(
            webhook_url=webhook_url,
            text=plan.fallback_text,
            blocks=blocks,
        )
    except SlackWebhookError as exc:
        raise SupportDeliveryFailed() from exc
