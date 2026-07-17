from __future__ import annotations

import pytest

from proliferate.server.cloud.integration_gateway.domain.tool_policy import (
    SLACK_MUTATING_TOOL_NAMES,
    SLACK_READ_TOOL_NAMES,
    ToolCallAllowed,
    ToolCallDenied,
    ToolCallRequiresApproval,
    decide_tool_call,
)

EXPECTED_SLACK_READ_TOOLS = {
    "slack_get_reactions",
    "slack_list_channel_members",
    "slack_list_starred_items",
    "slack_list_user_conversations",
    "slack_list_user_groups",
    "slack_list_workspaces",
    "slack_read_canvas",
    "slack_read_channel",
    "slack_read_file",
    "slack_read_thread",
    "slack_read_user_profile",
    "slack_search_channels",
    "slack_search_emojis",
    "slack_search_public",
    "slack_search_public_and_private",
    "slack_search_users",
}

EXPECTED_SLACK_MUTATING_FAMILIES = {
    "send": {"slack_send_message", "slack_send_message_draft"},
    "schedule": {"slack_schedule_message"},
    "message_update_delete": {"slack_edit_message", "slack_delete_message"},
    "reaction": {"slack_add_reaction"},
    "file_write": {"slack_get_file_upload_url", "slack_complete_file_upload"},
    "conversation_write": {
        "slack_create_conversation",
        "slack_invite_to_conversation",
        "slack_join_conversation",
        "slack_leave_conversation",
    },
    "canvas_write": {"slack_create_canvas", "slack_update_canvas"},
    "profile_write": {"slack_update_user_profile"},
    "reminder_write": {"slack_create_reminder"},
}


def test_slack_read_allowlist_is_exact() -> None:
    assert SLACK_READ_TOOL_NAMES == EXPECTED_SLACK_READ_TOOLS
    for tool in EXPECTED_SLACK_READ_TOOLS:
        assert decide_tool_call(provider="slack", tool=tool) == ToolCallAllowed(
            provider="slack", tool=tool
        )


@pytest.mark.parametrize(
    ("family", "tools"),
    EXPECTED_SLACK_MUTATING_FAMILIES.items(),
)
def test_every_known_slack_mutating_family_requires_approval(
    family: str,
    tools: set[str],
) -> None:
    assert family
    for tool in tools:
        assert decide_tool_call(provider="slack", tool=tool) == ToolCallRequiresApproval(
            provider="slack", tool=tool
        )


def test_slack_mutating_catalog_is_exact() -> None:
    expected = set().union(*EXPECTED_SLACK_MUTATING_FAMILIES.values())
    assert expected == SLACK_MUTATING_TOOL_NAMES
    assert SLACK_READ_TOOL_NAMES.isdisjoint(SLACK_MUTATING_TOOL_NAMES)


@pytest.mark.parametrize(
    "tool",
    [
        "slack_send_message_v2",
        "slack_search_public ",
        "Slack_search_public",
        "search_public",
    ],
)
def test_unknown_or_inexact_slack_tool_fails_closed(tool: str) -> None:
    assert decide_tool_call(provider="slack", tool=tool) == ToolCallDenied(
        provider="slack", tool=tool
    )


@pytest.mark.parametrize("provider", ["linear", "Slack", "slack ", "acme-slack"])
def test_other_provider_identities_preserve_direct_execution(provider: str) -> None:
    assert decide_tool_call(provider=provider, tool="slack_send_message") == ToolCallAllowed(
        provider=provider,
        tool="slack_send_message",
    )
