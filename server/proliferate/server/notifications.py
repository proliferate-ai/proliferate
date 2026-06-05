"""Best-effort internal Slack notifications."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Coroutine
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.background.config import NOTIFICATIONS_QUEUE, NOTIFICATIONS_SEND_SLACK_TASK
from proliferate.config import settings
from proliferate.db import engine as db_engine
from proliferate.db import session_ops as db_session
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
SIGNUP_SLACK_TASK_KIND = "signup"

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
    db: AsyncSession | None = None,
) -> None:
    payload = _signup_slack_notification_task_payload(
        notification,
        dedupe_key=dedupe_key,
    )
    task_id = f"signup-slack:{dedupe_key}" if dedupe_key else None
    if db is None:
        _enqueue_slack_notification_task(payload, task_id=task_id)
        return

    async def _enqueue_after_commit() -> None:
        _enqueue_slack_notification_task(payload, task_id=task_id)

    db_session.defer_after_commit(db, _enqueue_after_commit)


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


async def deliver_signup_slack_notification(
    notification: SignupSlackNotification,
    *,
    dedupe_key: str | None = None,
) -> bool:
    if dedupe_key is None:
        return await send_signup_slack_notification(notification)

    async with db_engine.async_session_factory() as db, db.begin():
        claim = await claim_webhook_event(
            db,
            provider=SIGNUP_SLACK_RECEIPT_PROVIDER,
            event_id=dedupe_key,
            event_type="desktop_github_signup",
        )
    if claim.status != "claimed" or claim.receipt is None:
        return False

    try:
        sent = await send_signup_slack_notification(notification)
    except Exception as exc:
        async with db_engine.async_session_factory() as db, db.begin():
            await mark_webhook_event_failed_by_id(
                db,
                receipt_id=claim.receipt.id,
                error=f"{type(exc).__name__}: {exc}",
            )
        logger.exception("Signup Slack notification task failed")
        return False

    if sent or not settings.signups_slack_webhook_url.strip():
        async with db_engine.async_session_factory() as db, db.begin():
            await mark_webhook_event_processed_by_id(db, receipt_id=claim.receipt.id)
        return sent

    async with db_engine.async_session_factory() as db, db.begin():
        await mark_webhook_event_failed_by_id(
            db,
            receipt_id=claim.receipt.id,
            error="signup Slack notification delivery failed",
        )
    return False


async def deliver_slack_notification_task_payload(payload: dict[str, object]) -> bool:
    kind = _payload_string(payload, "kind")
    if kind != SIGNUP_SLACK_TASK_KIND:
        raise ValueError(f"Unsupported Slack notification task kind: {kind}")

    body = _payload_dict(payload, "notification")
    return await deliver_signup_slack_notification(
        SignupSlackNotification(
            name=_payload_string(body, "name"),
            email=_payload_optional_string(body, "email"),
            github=_payload_optional_string(body, "github"),
            user_created_at=_parse_payload_datetime(body.get("user_created_at")),
        ),
        dedupe_key=_payload_optional_string(payload, "dedupe_key"),
    )


async def _deliver_billing_slack_notification(
    notification: BillingSlackNotification,
) -> None:
    async with db_engine.async_session_factory() as db, db.begin():
        claim = await claim_webhook_event(
            db,
            provider=BILLING_SLACK_RECEIPT_PROVIDER,
            event_id=f"{notification.stripe_subscription_id}:{notification.event}",
            event_type=f"subscription.{notification.event}",
        )
    if claim.status != "claimed" or claim.receipt is None:
        return

    try:
        sent = await send_billing_slack_notification(notification)
    except Exception as exc:
        async with db_engine.async_session_factory() as db, db.begin():
            await mark_webhook_event_failed_by_id(
                db,
                receipt_id=claim.receipt.id,
                error=f"{type(exc).__name__}: {exc}",
            )
        logger.exception("Billing Slack notification delivery failed")
        return

    if sent or not _billing_slack_webhook_configured(notification.event):
        async with db_engine.async_session_factory() as db, db.begin():
            await mark_webhook_event_processed_by_id(db, receipt_id=claim.receipt.id)
        return
    async with db_engine.async_session_factory() as db, db.begin():
        await mark_webhook_event_failed_by_id(
            db,
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


def _signup_slack_notification_task_payload(
    notification: SignupSlackNotification,
    *,
    dedupe_key: str | None,
) -> dict[str, object]:
    return {
        "kind": SIGNUP_SLACK_TASK_KIND,
        "dedupe_key": dedupe_key,
        "notification": {
            "name": notification.name,
            "email": notification.email,
            "github": notification.github,
            "user_created_at": (
                notification.user_created_at.isoformat()
                if notification.user_created_at is not None
                else None
            ),
        },
    }


def _enqueue_slack_notification_task(
    payload: dict[str, object],
    *,
    task_id: str | None,
) -> bool:
    try:
        _send_slack_task_to_celery(payload, task_id=task_id)
    except Exception:
        logger.exception("Could not enqueue Slack notification task")
        return False
    return True


def _send_slack_task_to_celery(
    payload: dict[str, object],
    *,
    task_id: str | None,
) -> None:
    from proliferate.background.celery_app import celery_app

    celery_app.send_task(
        NOTIFICATIONS_SEND_SLACK_TASK,
        args=(payload,),
        queue=NOTIFICATIONS_QUEUE,
        task_id=task_id,
    )


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


def _payload_dict(payload: dict[str, object], key: str) -> dict[str, object]:
    value = payload.get(key)
    if not isinstance(value, dict):
        raise ValueError(f"Slack notification payload missing {key}.")
    return value


def _payload_string(payload: dict[str, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"Slack notification payload missing {key}.")
    return value


def _payload_optional_string(payload: dict[str, object], key: str) -> str | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"Slack notification payload has invalid {key}.")
    return value


def _parse_payload_datetime(value: object) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("Slack notification payload has invalid user_created_at.")
    return datetime.fromisoformat(value)
