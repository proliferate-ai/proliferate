"""Workflow notification definition and Slack channel endpoint tests."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from proliferate.db.store.integrations.accounts import ReadyAccountRow
from proliferate.server.cloud.workflows.domain.definition import (
    WorkflowDefinitionError,
    parse_definition,
)
from tests.unit.workflow_action_test_support import _make_user

# --- notify-step validator requires slack_channel_id for slack channel -----------


def _notify_definition(step: dict) -> dict:
    return {
        "version": 1,
        "inputs": [],
        "integrations": ["slack"],
        "agents": [
            {"slot": "main", "harness": "claude", "model": "sonnet", "steps": [step]},
        ],
    }


def test_notify_validator_requires_slack_channel_id() -> None:
    definition = _notify_definition({"kind": "notify", "message": "hello"})
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert "slack_channel_id" in exc.value.message


def test_notify_validator_accepts_slack_channel_id() -> None:
    definition = _notify_definition(
        {"kind": "notify", "message": "hello", "slack_channel_id": "C1234"}
    )
    canonical, _specs = parse_definition(definition)
    assert canonical["agents"][0]["steps"][0]["slack_channel_id"] == "C1234"


def test_notify_validator_rejects_channel_discriminator() -> None:
    # E1b: the channel discriminator (and in_app) are gone — notify is Slack-only.
    definition = _notify_definition(
        {"kind": "notify", "channel": "in_app", "message": "hi", "slack_channel_id": "C1"}
    )
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "unknown_field"


# --- channels endpoint connected / not-connected --------------------------------


async def test_slack_channels_endpoint_not_connected(client) -> None:  # type: ignore[no-untyped-def]
    """When no slack account, returns connected=false with empty list."""
    from proliferate.db import engine as engine_module

    session_factory = engine_module.async_session_factory
    async with session_factory() as db:
        user = await _make_user(db)
        await db.commit()

    from proliferate.server.cloud.workflows.api import list_slack_channels_endpoint

    # Direct unit test of the logic
    async with session_factory() as db:
        with patch(
            "proliferate.server.cloud.workflows.service.accounts_store.get_ready_account_for_provider",
            new_callable=AsyncMock,
            return_value=None,
        ):
            result = await list_slack_channels_endpoint(db=db, user=user)
    assert result.connected is False
    assert result.channels == []


async def test_slack_channels_endpoint_connected(client) -> None:  # type: ignore[no-untyped-def]
    """When slack account exists, returns connected=true with channels."""
    from proliferate.db import engine as engine_module
    from proliferate.integrations.slack.client import SlackChannelSummary

    session_factory = engine_module.async_session_factory
    async with session_factory() as db:
        user = await _make_user(db)
        await db.commit()

    fake_account = type("FakeAccount", (), {"credential_ciphertext": "enc"})()
    fake_def = type("FakeDef", (), {})()
    fake_channels = [
        SlackChannelSummary(
            id="C1", name="general", is_channel=True, is_private=False, is_archived=False
        ),
        SlackChannelSummary(
            id="C2", name="random", is_channel=True, is_private=False, is_archived=False
        ),
    ]

    from proliferate.server.cloud.workflows.api import list_slack_channels_endpoint

    async with session_factory() as db:
        with (
            patch(
                "proliferate.server.cloud.workflows.service.accounts_store.get_ready_account_for_provider",
                new_callable=AsyncMock,
                return_value=ReadyAccountRow(
                    account=fake_account, definition=fake_def, org_policy_enabled=None
                ),
            ),
            patch(
                "proliferate.server.cloud.workflows.service.decrypt_json",
                return_value={"bot_token": "xoxb-test"},
            ),
            patch(
                "proliferate.server.cloud.workflows.service.slack_client.list_channels",
                new_callable=AsyncMock,
                return_value=fake_channels,
            ),
        ):
            result = await list_slack_channels_endpoint(db=db, user=user)
    assert result.connected is True
    assert len(result.channels) == 2
    assert result.channels[0].id == "C1"


async def test_slack_channels_endpoint_reads_oauth_bundle_access_token(client) -> None:  # type: ignore[no-untyped-def]
    """The oauth-bundle-v1 credential stores the token under camelCase
    ``accessToken`` (not ``bot_token``/``access_token``). The picker must read it,
    otherwise it wrongly reports connected=false with no channels."""
    from proliferate.db import engine as engine_module
    from proliferate.integrations.slack.client import SlackChannelSummary

    session_factory = engine_module.async_session_factory
    async with session_factory() as db:
        user = await _make_user(db)
        await db.commit()

    fake_account = type("FakeAccount", (), {"credential_ciphertext": "enc"})()
    fake_def = type("FakeDef", (), {})()
    fake_channels = [
        SlackChannelSummary(
            id="C9", name="general", is_channel=True, is_private=False, is_archived=False
        ),
    ]

    from proliferate.server.cloud.workflows.api import list_slack_channels_endpoint

    async with session_factory() as db:
        with (
            patch(
                "proliferate.server.cloud.workflows.service.accounts_store.get_ready_account_for_provider",
                new_callable=AsyncMock,
                return_value=ReadyAccountRow(
                    account=fake_account, definition=fake_def, org_policy_enabled=None
                ),
            ),
            patch(
                "proliferate.server.cloud.workflows.service.decrypt_json",
                return_value={"accessToken": "xoxp-oauth-bundle-token"},
            ),
            patch(
                "proliferate.server.cloud.workflows.service.slack_client.list_channels",
                new_callable=AsyncMock,
                return_value=fake_channels,
            ) as list_channels_mock,
        ):
            result = await list_slack_channels_endpoint(db=db, user=user)
    assert result.connected is True
    assert len(result.channels) == 1
    list_channels_mock.assert_awaited_once_with(bot_token="xoxp-oauth-bundle-token")
