"""Best-effort internal Slack notifications."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Coroutine
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from proliferate.config import settings
from proliferate.db import engine as db_engine
from proliferate.db.store.billing import (
    claim_webhook_event,
    mark_webhook_event_failed_by_id,
    mark_webhook_event_processed_by_id,
)
from proliferate.db.store.notifications import (
    BillingSlackNotificationContext,
    get_billing_slack_notification_context,
)
from proliferate.integrations.slack.errors import SlackWebhookError
from proliferate.integrations.slack.messages import (
    SlackMessageField,
    build_mrkdwn_message_blocks,
)
from proliferate.integrations.slack.webhooks import post_incoming_webhook

BillingSlackEvent = Literal["subscribed", "cancelled"]
SIGNUP_SLACK_RECEIPT_PROVIDER = "signup_slack"
BILLING_SLACK_RECEIPT_PROVIDER = "billing_slack"

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SlackNotificationMessage:
    text: str
    blocks: list[dict[str, object]]


@dataclass(frozen=True)
class SignupSlackNotification:
    name: str
    email: str | None
    github: str | None
    user_created_at: datetime | None


@dataclass(frozen=True)
class BillingSlackNotification:
    event: BillingSlackEvent
    stripe_subscription_id: str
    name: str
    email: str | None
    github: str | None
    user_created_at: datetime | None
    workspace_count: int
    organization_user_count: int


def build_signup_slack_message(notification: SignupSlackNotification) -> SlackNotificationMessage:
    title = f"{notification.name} signed up"
    fields = (
        SlackMessageField("email", _present(notification.email)),
        SlackMessageField("github", _present(notification.github)),
        SlackMessageField("user created", _format_natural_date(notification.user_created_at)),
    )
    return _message(kind="signup", title=title, fields=fields)


def build_billing_slack_message(
    notification: BillingSlackNotification,
) -> SlackNotificationMessage:
    title = f"{notification.name} {notification.event}"
    fields = (
        SlackMessageField("email", _present(notification.email)),
        SlackMessageField("github", _present(notification.github)),
        SlackMessageField("user created", _format_natural_date(notification.user_created_at)),
        SlackMessageField("workspaces", str(notification.workspace_count)),
        SlackMessageField("number of users in org", str(notification.organization_user_count)),
    )
    return _message(kind="billing", title=title, fields=fields)


async def send_signup_slack_notification(notification: SignupSlackNotification) -> bool:
    webhook_url = settings.signups_slack_webhook_url.strip()
    if not webhook_url:
        return False
    message = build_signup_slack_message(notification)
    try:
        await post_incoming_webhook(
            webhook_url=webhook_url,
            text=message.text,
            blocks=message.blocks,
        )
    except SlackWebhookError:
        logger.exception("Failed to send signup Slack notification")
        return False
    return True


async def send_billing_slack_notification(notification: BillingSlackNotification) -> bool:
    webhook_url = (
        settings.billing_positive_slack_webhook_url
        if notification.event == "subscribed"
        else settings.billing_negative_slack_webhook_url
    ).strip()
    if not webhook_url:
        return False
    message = build_billing_slack_message(notification)
    try:
        await post_incoming_webhook(
            webhook_url=webhook_url,
            text=message.text,
            blocks=message.blocks,
        )
    except SlackWebhookError:
        logger.exception("Failed to send billing Slack notification")
        return False
    return True


async def load_billing_slack_notification_context(
    *,
    billing_subject_id: UUID,
) -> BillingSlackNotificationContext | None:
    async with db_engine.async_session_factory() as db:
        return await get_billing_slack_notification_context(
            db,
            billing_subject_id=billing_subject_id,
        )


async def deliver_billing_slack_notifications(
    notifications: tuple[BillingSlackNotification, ...],
) -> None:
    for notification in notifications:
        await _deliver_billing_slack_notification(notification)


def schedule_signup_slack_notification(
    notification: SignupSlackNotification,
    *,
    dedupe_key: str | None = None,
) -> None:
    if dedupe_key:
        _schedule(
            _send_claimed_signup_slack_notification(
                notification,
                dedupe_key=dedupe_key,
            ),
            name="signup-slack-notification",
        )
        return
    _schedule(
        send_signup_slack_notification(notification),
        name="signup-slack-notification",
    )


def schedule_billing_slack_notification(notification: BillingSlackNotification) -> None:
    _schedule(
        send_billing_slack_notification(notification),
        name=f"billing-slack-notification-{notification.event}",
    )


def _message(
    *,
    kind: str,
    title: str,
    fields: tuple[SlackMessageField, ...],
) -> SlackNotificationMessage:
    blocks = build_mrkdwn_message_blocks(
        title=f"*{title}*",
        body=kind,
        fields=fields,
    )
    return SlackNotificationMessage(
        text="\n".join(
            [kind, f"# {title}"] + [f"{field.label}: {field.value}" for field in fields]
        ),
        blocks=blocks,
    )


async def _send_claimed_signup_slack_notification(
    notification: SignupSlackNotification,
    *,
    dedupe_key: str,
) -> bool:
    claim = await claim_webhook_event(
        provider=SIGNUP_SLACK_RECEIPT_PROVIDER,
        event_id=dedupe_key,
        event_type="desktop_github_signup",
    )
    if claim.status != "claimed" or claim.receipt is None:
        return False

    try:
        sent = await send_signup_slack_notification(notification)
    except Exception as exc:
        await mark_webhook_event_failed_by_id(
            receipt_id=claim.receipt.id,
            error=f"{type(exc).__name__}: {exc}",
        )
        logger.exception("Signup Slack notification task failed")
        return False

    if sent or not settings.signups_slack_webhook_url.strip():
        await mark_webhook_event_processed_by_id(receipt_id=claim.receipt.id)
        return sent

    await mark_webhook_event_failed_by_id(
        receipt_id=claim.receipt.id,
        error="signup Slack notification delivery failed",
    )
    return False


async def _deliver_billing_slack_notification(
    notification: BillingSlackNotification,
) -> None:
    claim = await claim_webhook_event(
        provider=BILLING_SLACK_RECEIPT_PROVIDER,
        event_id=f"{notification.stripe_subscription_id}:{notification.event}",
        event_type=f"subscription.{notification.event}",
    )
    if claim.status != "claimed" or claim.receipt is None:
        return

    try:
        sent = await send_billing_slack_notification(notification)
    except Exception as exc:
        await mark_webhook_event_failed_by_id(
            receipt_id=claim.receipt.id,
            error=f"{type(exc).__name__}: {exc}",
        )
        logger.exception("Billing Slack notification delivery failed")
        return

    if sent or not _billing_slack_webhook_configured(notification.event):
        await mark_webhook_event_processed_by_id(receipt_id=claim.receipt.id)
        return
    await mark_webhook_event_failed_by_id(
        receipt_id=claim.receipt.id,
        error="billing Slack notification delivery failed",
    )


def _billing_slack_webhook_configured(event: BillingSlackEvent) -> bool:
    webhook_url = (
        settings.billing_positive_slack_webhook_url
        if event == "subscribed"
        else settings.billing_negative_slack_webhook_url
    )
    return bool(webhook_url.strip())


def _schedule(awaitable: Coroutine[object, object, bool], *, name: str) -> bool:
    try:
        task = asyncio.create_task(awaitable, name=name)
    except Exception:
        awaitable.close()
        logger.exception("Could not schedule Slack notification task")
        return False
    task.add_done_callback(_handle_task_completion)
    return True


def _handle_task_completion(task: asyncio.Task[bool]) -> None:
    if task.cancelled():
        return

    exc = task.exception()
    if exc is None:
        return

    logger.exception(
        "Slack notification task failed unexpectedly",
        exc_info=(type(exc), exc, exc.__traceback__),
    )


def _present(value: str | None) -> str:
    cleaned = (value or "").strip()
    return cleaned or "unknown"


def _format_natural_date(value: datetime | None) -> str:
    if value is None:
        return "unknown"
    normalized = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    normalized = normalized.astimezone(UTC)
    return f"{normalized:%B} {normalized.day}, {normalized.year}"
