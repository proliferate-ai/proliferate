from __future__ import annotations

from dataclasses import dataclass

from proliferate.config import settings
from proliferate.db.models.auth import User
from proliferate.integrations.slack.errors import SlackWebhookError
from proliferate.integrations.slack.webhooks import post_incoming_webhook
from proliferate.middleware.request_context import get_request_id


@dataclass(slots=True)
class SupportServiceError(Exception):
    status_code: int
    code: str
    message: str

    def __str__(self) -> str:
        return self.message


def _escape_slack_text(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _field(label: str, value: str) -> dict[str, str]:
    return {
        "type": "mrkdwn",
        "text": f"*{_escape_slack_text(label)}*\n{_escape_slack_text(value)}",
    }


async def send_support_message(
    user: User,
    *,
    message: str,
    context: dict[str, object] | None = None,
) -> None:
    webhook_url = settings.support_slack_webhook_url.strip()
    if not webhook_url:
        raise SupportServiceError(
            status_code=503,
            code="support_unavailable",
            message="Support messaging is not configured for this environment.",
        )

    cleaned_message = message.strip()
    if not cleaned_message:
        raise SupportServiceError(
            status_code=400,
            code="support_message_empty",
            message="Support message cannot be empty.",
        )

    payload_context = context or {}
    sender_name = user.display_name or user.email
    pathname = payload_context.get("pathname")
    source = payload_context.get("source")
    intent = payload_context.get("intent")
    workspace_name = payload_context.get("workspace_name")
    workspace_location = payload_context.get("workspace_location")
    workspace_id = payload_context.get("workspace_id")
    request_id = get_request_id()

    fields = [
        _field("From", sender_name),
        _field("Email", user.email),
    ]
    if source:
        fields.append(_field("Source", str(source)))
    if intent:
        fields.append(_field("Intent", str(intent)))
    if pathname:
        fields.append(_field("Page", str(pathname)))
    if workspace_name:
        workspace_value = str(workspace_name)
        if workspace_location:
            workspace_value = f"{workspace_location} · {workspace_value}"
        fields.append(_field("Workspace", workspace_value))
    elif workspace_location:
        fields.append(_field("Workspace", str(workspace_location)))
    if workspace_id:
        fields.append(_field("Workspace ID", str(workspace_id)))
    if request_id:
        fields.append(_field("Request ID", request_id))

    blocks: list[dict[str, object]] = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "*New support message*",
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": _escape_slack_text(cleaned_message),
            },
        },
    ]
    if fields:
        blocks.append({"type": "section", "fields": fields[:10]})

    fallback_text = f"Support message from {sender_name}: {cleaned_message[:140]}"

    try:
        await post_incoming_webhook(
            webhook_url=webhook_url,
            text=fallback_text,
            blocks=blocks,
        )
    except SlackWebhookError as exc:
        raise SupportServiceError(
            status_code=502,
            code="support_delivery_failed",
            message="Support message could not be delivered.",
        ) from exc
