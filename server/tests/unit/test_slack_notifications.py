from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.background.config import NOTIFICATIONS_QUEUE, NOTIFICATIONS_SEND_SLACK_TASK
from proliferate.config import settings
from proliferate.db.models.billing import WebhookEventReceipt
from proliferate.integrations.slack.errors import SlackWebhookError
from proliferate.server import notifications
from proliferate.server.notifications import (
    BillingSlackNotification,
    SignupSlackNotification,
    build_billing_slack_message,
    build_signup_slack_message,
    deliver_signup_slack_notification,
    send_billing_slack_notification,
    send_signup_slack_notification,
)


def test_build_signup_slack_message_uses_requested_lines() -> None:
    message = build_signup_slack_message(
        SignupSlackNotification(
            name="Ada Lovelace",
            email="ada@example.com",
            github="ada",
            user_created_at=datetime(2026, 5, 19, 12, 30, tzinfo=UTC),
        )
    )

    assert message.text == "\n".join(
        [
            "signup",
            "# Ada Lovelace signed up",
            "email: ada@example.com",
            "github: ada",
            "user created: May 19, 2026",
        ]
    )
    assert message.blocks[0]["text"]["text"] == "*Ada Lovelace signed up*"


def test_build_billing_slack_message_uses_requested_lines() -> None:
    message = build_billing_slack_message(
        BillingSlackNotification(
            event="subscribed",
            stripe_subscription_id="sub_acme",
            name="Acme",
            email="founder@example.com",
            github="founder",
            user_created_at=datetime(2026, 5, 18, 9, 0, tzinfo=UTC),
            workspace_count=3,
            organization_user_count=7,
        )
    )

    assert message.text == "\n".join(
        [
            "billing",
            "# Acme subscribed",
            "email: founder@example.com",
            "github: founder",
            "user created: May 18, 2026",
            "workspaces: 3",
            "number of users in org: 7",
        ]
    )
    assert message.blocks[0]["text"]["text"] == "*Acme subscribed*"


@pytest.mark.asyncio
async def test_signup_slack_notification_noops_without_webhook(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "signups_slack_webhook_url", "")

    sent = await send_signup_slack_notification(
        SignupSlackNotification(
            name="Ada",
            email="ada@example.com",
            github=None,
            user_created_at=None,
        )
    )

    assert sent is False


@pytest.mark.asyncio
async def test_signup_slack_notification_posts_expected_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    async def fake_post_incoming_webhook(
        *,
        webhook_url: str,
        text: str,
        blocks: list[dict[str, object]] | None = None,
    ) -> None:
        calls.append({"webhook_url": webhook_url, "text": text, "blocks": blocks})

    monkeypatch.setattr(settings, "signups_slack_webhook_url", "https://signups")
    monkeypatch.setattr(notifications, "post_incoming_webhook", fake_post_incoming_webhook)

    sent = await send_signup_slack_notification(
        SignupSlackNotification(
            name="Ada",
            email="ada@example.com",
            github="ada",
            user_created_at=datetime(2026, 5, 19, tzinfo=UTC),
        )
    )

    assert sent is True
    assert calls[0]["webhook_url"] == "https://signups"
    assert calls[0]["text"] == "\n".join(
        [
            "signup",
            "# Ada signed up",
            "email: ada@example.com",
            "github: ada",
            "user created: May 19, 2026",
        ]
    )


async def _drain_scheduled_signup_notifications() -> None:
    pending = [
        task
        for task in asyncio.all_tasks()
        if task is not asyncio.current_task() and task.get_name() == "signup-slack-notification"
    ]
    if pending:
        await asyncio.gather(*pending)


@pytest.mark.asyncio
async def test_schedule_signup_slack_notification_delivers_inline_when_webhook_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    async def fake_post_incoming_webhook(
        *,
        webhook_url: str,
        text: str,
        blocks: list[dict[str, object]] | None = None,
    ) -> None:
        calls.append({"webhook_url": webhook_url, "text": text, "blocks": blocks})

    monkeypatch.setattr(settings, "signups_slack_webhook_url", "https://signups")
    monkeypatch.setattr(notifications, "post_incoming_webhook", fake_post_incoming_webhook)

    notifications.schedule_signup_slack_notification(
        SignupSlackNotification(
            name="Ada",
            email="ada@example.com",
            github="ada",
            user_created_at=None,
        ),
    )
    await _drain_scheduled_signup_notifications()

    assert len(calls) == 1
    assert calls[0]["webhook_url"] == "https://signups"
    assert calls[0]["text"] == "\n".join(
        [
            "signup",
            "# Ada signed up",
            "email: ada@example.com",
            "github: ada",
            "user created: unknown",
        ]
    )


@pytest.mark.asyncio
async def test_schedule_signup_slack_notification_noops_when_webhook_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    async def fake_post_incoming_webhook(
        *,
        webhook_url: str,
        text: str,
        blocks: list[dict[str, object]] | None = None,
    ) -> None:
        calls.append({"webhook_url": webhook_url, "text": text, "blocks": blocks})

    monkeypatch.setattr(settings, "signups_slack_webhook_url", "")
    monkeypatch.setattr(notifications, "post_incoming_webhook", fake_post_incoming_webhook)

    notifications.schedule_signup_slack_notification(
        SignupSlackNotification(
            name="Ada",
            email="ada@example.com",
            github="ada",
            user_created_at=None,
        ),
    )
    await _drain_scheduled_signup_notifications()

    assert calls == []


def test_send_slack_task_dispatches_signup_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, object]] = []

    async def fake_deliver_signup_slack_notification(
        notification: SignupSlackNotification,
        *,
        dedupe_key: str | None = None,
    ) -> bool:
        calls.append({"notification": notification, "dedupe_key": dedupe_key})
        return True

    monkeypatch.setattr(
        notifications,
        "deliver_signup_slack_notification",
        fake_deliver_signup_slack_notification,
    )
    from proliferate.background.tasks.notifications import send_slack

    sent = send_slack.run(
        {
            "kind": "signup",
            "dedupe_key": "github:ada",
            "notification": {
                "name": "Ada",
                "email": "ada@example.com",
                "github": "ada",
                "user_created_at": "2026-05-19T00:00:00+00:00",
            },
        }
    )

    assert sent is True
    assert calls == [
        {
            "notification": SignupSlackNotification(
                name="Ada",
                email="ada@example.com",
                github="ada",
                user_created_at=datetime(2026, 5, 19, tzinfo=UTC),
            ),
            "dedupe_key": "github:ada",
        }
    ]
    assert send_slack.name == NOTIFICATIONS_SEND_SLACK_TASK
    assert send_slack.app.conf.task_routes[NOTIFICATIONS_SEND_SLACK_TASK] == {
        "queue": NOTIFICATIONS_QUEUE
    }


@pytest.mark.asyncio
async def test_signup_slack_duplicate_task_delivery_posts_once(
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(notifications.db_engine, "async_session_factory", session_factory)
    calls: list[str] = []

    async def fake_post_incoming_webhook(
        *,
        webhook_url: str,
        text: str,
        blocks: list[dict[str, object]] | None = None,
    ) -> None:
        del text, blocks
        calls.append(webhook_url)

    monkeypatch.setattr(settings, "signups_slack_webhook_url", "https://signups")
    monkeypatch.setattr(notifications, "post_incoming_webhook", fake_post_incoming_webhook)
    notification = SignupSlackNotification(
        name="Ada",
        email="ada@example.com",
        github="ada",
        user_created_at=None,
    )

    first_sent = await deliver_signup_slack_notification(
        notification,
        dedupe_key="github:ada",
    )
    duplicate_sent = await deliver_signup_slack_notification(
        notification,
        dedupe_key="github:ada",
    )

    assert first_sent is True
    assert duplicate_sent is False
    assert calls == ["https://signups"]
    async with session_factory() as db:
        receipts = (
            (
                await db.execute(
                    select(WebhookEventReceipt).where(
                        WebhookEventReceipt.provider
                        == notifications.SIGNUP_SLACK_RECEIPT_PROVIDER,
                        WebhookEventReceipt.event_id == "github:ada",
                    )
                )
            )
            .scalars()
            .all()
        )
    assert len(receipts) == 1
    assert receipts[0].status == "processed"
    assert receipts[0].attempt_count == 1


@pytest.mark.asyncio
async def test_billing_slack_notification_uses_positive_and_negative_webhooks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    async def fake_post_incoming_webhook(
        *,
        webhook_url: str,
        text: str,
        blocks: list[dict[str, object]] | None = None,
    ) -> None:
        del text, blocks
        calls.append(webhook_url)

    monkeypatch.setattr(settings, "billing_positive_slack_webhook_url", "https://positive")
    monkeypatch.setattr(settings, "billing_negative_slack_webhook_url", "https://negative")
    monkeypatch.setattr(notifications, "post_incoming_webhook", fake_post_incoming_webhook)

    base = dict(
        name="Acme",
        stripe_subscription_id="sub_acme",
        email="founder@example.com",
        github="founder",
        user_created_at=None,
        workspace_count=0,
        organization_user_count=1,
    )
    assert await send_billing_slack_notification(
        BillingSlackNotification(event="subscribed", **base)
    )
    assert await send_billing_slack_notification(
        BillingSlackNotification(event="cancelled", **base)
    )

    assert calls == ["https://positive", "https://negative"]


@pytest.mark.asyncio
async def test_slack_webhook_failure_is_best_effort(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_post_incoming_webhook(
        *,
        webhook_url: str,
        text: str,
        blocks: list[dict[str, object]] | None = None,
    ) -> None:
        del webhook_url, text, blocks
        raise SlackWebhookError("boom")

    monkeypatch.setattr(settings, "signups_slack_webhook_url", "https://signups")
    monkeypatch.setattr(notifications, "post_incoming_webhook", fake_post_incoming_webhook)

    sent = await send_signup_slack_notification(
        SignupSlackNotification(
            name="Ada",
            email="ada@example.com",
            github="ada",
            user_created_at=None,
        )
    )

    assert sent is False
