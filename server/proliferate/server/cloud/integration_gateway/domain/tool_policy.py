"""Pure provider-tool policy for integration gateway calls.

Slack is the first provider whose upstream catalog mixes read-only and external
actions behind one OAuth-backed MCP endpoint.  Keep the decision exact and
data-only so a later durable approval service can consume the same verdict
without trusting agent arguments or an in-memory confirmation flag.
"""

from __future__ import annotations

from dataclasses import dataclass

SLACK_PROVIDER = "slack"

# Canonical Slack MCP names are matched exactly.  A newly introduced or renamed
# Slack tool is denied until this policy is deliberately updated.
SLACK_READ_TOOL_NAMES = frozenset(
    {
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
)

SLACK_MUTATING_TOOL_NAMES = frozenset(
    {
        "slack_add_reaction",
        "slack_complete_file_upload",
        "slack_create_canvas",
        "slack_create_conversation",
        "slack_create_reminder",
        "slack_delete_message",
        "slack_edit_message",
        "slack_get_file_upload_url",
        "slack_invite_to_conversation",
        "slack_join_conversation",
        "slack_leave_conversation",
        "slack_schedule_message",
        "slack_send_message",
        "slack_send_message_draft",
        "slack_update_canvas",
        "slack_update_user_profile",
    }
)


@dataclass(frozen=True)
class ToolCallAllowed:
    provider: str
    tool: str


@dataclass(frozen=True)
class ToolCallRequiresApproval:
    provider: str
    tool: str


@dataclass(frozen=True)
class ToolCallDenied:
    provider: str
    tool: str


ToolCallPolicyDecision = ToolCallAllowed | ToolCallRequiresApproval | ToolCallDenied


def decide_tool_call(*, provider: str, tool: str) -> ToolCallPolicyDecision:
    """Classify one exact provider/tool identity without inspecting arguments."""
    if provider != SLACK_PROVIDER:
        return ToolCallAllowed(provider=provider, tool=tool)
    if tool in SLACK_READ_TOOL_NAMES:
        return ToolCallAllowed(provider=provider, tool=tool)
    if tool in SLACK_MUTATING_TOOL_NAMES:
        return ToolCallRequiresApproval(provider=provider, tool=tool)
    return ToolCallDenied(provider=provider, tool=tool)
