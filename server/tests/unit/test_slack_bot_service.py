from __future__ import annotations

import uuid
from dataclasses import replace
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from proliferate.db.store.cloud_slack.records import (
    SlackOutboundMessageRecord,
    SlackWorkspaceConnectionRecord,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.slack import service
from proliferate.server.cloud.slack.worker import outbound


def _connection() -> SlackWorkspaceConnectionRecord:
    now = datetime(2026, 5, 21, tzinfo=UTC)
    return SlackWorkspaceConnectionRecord(
        id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        slack_team_id="T123",
        slack_team_name="Acme",
        slack_bot_user_id="U123",
        bot_token_ciphertext="not-a-fernet-token",
        bot_token_ciphertext_key_id="cloud-secret-v1",
        bot_scopes="chat:write",
        status="active",
        installed_by_user_id=uuid.uuid4(),
        installed_at=now,
        last_validated_at=now,
        revoked_at=None,
        created_at=now,
        updated_at=now,
    )


def _outbound_message(connection: SlackWorkspaceConnectionRecord) -> SlackOutboundMessageRecord:
    now = datetime(2026, 5, 21, tzinfo=UTC)
    return SlackOutboundMessageRecord(
        id=uuid.uuid4(),
        organization_id=connection.organization_id,
        slack_workspace_connection_id=connection.id,
        slack_team_id=connection.slack_team_id,
        slack_channel_id="C123",
        slack_thread_ts="1779362127.000001",
        blocks_json=[{"type": "section", "text": {"type": "mrkdwn", "text": "hello"}}],
        fallback_text="hello",
        source="turn",
        source_event_id="event-1",
        status="queued",
        attempts=0,
        next_attempt_at=now,
        last_error_code=None,
        last_error_message=None,
        sent_message_ts=None,
        created_at=now,
        updated_at=now,
        sent_at=None,
    )


@pytest.mark.asyncio
async def test_validate_connection_returns_reauth_for_invalid_bot_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _connection()
    marked: list[uuid.UUID] = []

    async def allow_admin(*args: object, **kwargs: object) -> None:
        return None

    async def active_connection(*args: object, **kwargs: object) -> SlackWorkspaceConnectionRecord:
        return connection

    async def mark_reauth(*args: object, **kwargs: object) -> None:
        marked.append(kwargs["connection_id"])  # type: ignore[arg-type]

    async def fail_auth_test(*args: object, **kwargs: object) -> None:
        raise AssertionError("Slack auth_test should not run with an undecryptable token")

    monkeypatch.setattr(service, "_require_org_admin", allow_admin)
    monkeypatch.setattr(
        service.connection_store,
        "get_active_connection_for_org",
        active_connection,
    )
    monkeypatch.setattr(service.connection_store, "mark_connection_reauth_required", mark_reauth)
    monkeypatch.setattr(service.slack_client, "auth_test", fail_auth_test)

    ok, status, team_name, error_code = await service.validate_connection(
        None,  # type: ignore[arg-type]
        SimpleNamespace(id=uuid.uuid4()),  # type: ignore[arg-type]
        organization_id=connection.organization_id,
    )

    assert ok is False
    assert status == "reauth_required"
    assert team_name is None
    assert error_code == "slack_connection_reauth_required"
    assert marked == [connection.id]


@pytest.mark.asyncio
async def test_list_channels_raises_typed_reauth_for_invalid_bot_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _connection()
    marked: list[uuid.UUID] = []

    async def allow_admin(*args: object, **kwargs: object) -> None:
        return None

    async def active_connection(*args: object, **kwargs: object) -> SlackWorkspaceConnectionRecord:
        return connection

    async def mark_reauth(*args: object, **kwargs: object) -> None:
        marked.append(kwargs["connection_id"])  # type: ignore[arg-type]

    async def fail_list_channels(*args: object, **kwargs: object) -> None:
        raise AssertionError("Slack channels should not be listed with an undecryptable token")

    monkeypatch.setattr(service, "_require_org_admin", allow_admin)
    monkeypatch.setattr(
        service.connection_store,
        "get_active_connection_for_org",
        active_connection,
    )
    monkeypatch.setattr(service.connection_store, "mark_connection_reauth_required", mark_reauth)
    monkeypatch.setattr(service.slack_client, "list_channels", fail_list_channels)

    with pytest.raises(CloudApiError) as exc_info:
        await service.list_channels(
            None,  # type: ignore[arg-type]
            SimpleNamespace(id=uuid.uuid4()),  # type: ignore[arg-type]
            organization_id=connection.organization_id,
        )

    assert exc_info.value.code == "slack_connection_reauth_required"
    assert exc_info.value.status_code == 409
    assert marked == [connection.id]


@pytest.mark.asyncio
async def test_outbound_send_marks_failed_when_connection_needs_reauth(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _connection()
    message = _outbound_message(connection)
    marked_reauth: list[uuid.UUID] = []
    failed: dict[str, object] = {}

    async def mark_sending(*args: object, **kwargs: object) -> SlackOutboundMessageRecord:
        return replace(message, status="sending")

    async def get_connection(*args: object, **kwargs: object) -> SlackWorkspaceConnectionRecord:
        return connection

    async def mark_reauth(*args: object, **kwargs: object) -> None:
        marked_reauth.append(kwargs["connection_id"])  # type: ignore[arg-type]

    async def mark_failed(*args: object, **kwargs: object) -> None:
        failed.update(kwargs)

    async def fail_chat_post(*args: object, **kwargs: object) -> None:
        raise AssertionError("Slack post should not run with an undecryptable token")

    monkeypatch.setattr(outbound.outbound_store, "mark_outbound_sending", mark_sending)
    monkeypatch.setattr(outbound.connection_store, "get_connection", get_connection)
    monkeypatch.setattr(outbound.connection_store, "mark_connection_reauth_required", mark_reauth)
    monkeypatch.setattr(outbound.outbound_store, "mark_outbound_failed", mark_failed)
    monkeypatch.setattr(outbound.slack_client, "chat_post_message", fail_chat_post)

    await outbound.send_outbound_message(None, message)  # type: ignore[arg-type]

    assert marked_reauth == [connection.id]
    assert failed["message_id"] == message.id
    assert failed["error_code"] == "slack_connection_reauth_required"
