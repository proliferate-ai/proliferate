"""Post-session Slack notification hooks."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.slack import (
    SLACK_OUTBOUND_SOURCE_TURN,
    SLACK_THREAD_WORK_STATUS_ACTIVE,
)
from proliferate.db.store.cloud_slack import connections as connection_store
from proliferate.db.store.cloud_slack import outbound as outbound_store
from proliferate.db.store.cloud_slack import thread_work as thread_work_store
from proliferate.server.cloud.slack.domain.message_format import completion_blocks


async def enqueue_post_session_event(
    db: AsyncSession,
    *,
    cloud_workspace_id: UUID | None,
    session_id: str,
    event_type: str,
    event_payload: dict[str, object],
    seq: int,
) -> None:
    if cloud_workspace_id is None:
        return
    thread_work = await thread_work_store.get_thread_work_by_workspace(
        db,
        cloud_workspace_id=cloud_workspace_id,
    )
    if thread_work is None or thread_work.status != SLACK_THREAD_WORK_STATUS_ACTIVE:
        return
    connection = await connection_store.get_active_connection_for_org(
        db,
        organization_id=thread_work.organization_id,
    )
    if connection is None:
        return
    text = _post_session_text(event_type=event_type, event_payload=event_payload)
    if not text:
        return
    fallback, blocks = completion_blocks(message=text, web_url=_workspace_url(cloud_workspace_id))
    await outbound_store.enqueue_outbound_message(
        db,
        organization_id=thread_work.organization_id,
        slack_workspace_connection_id=connection.id,
        slack_team_id=thread_work.slack_team_id,
        slack_channel_id=thread_work.slack_channel_id,
        slack_thread_ts=thread_work.slack_thread_ts,
        blocks_json=blocks,
        fallback_text=fallback,
        source=SLACK_OUTBOUND_SOURCE_TURN,
        source_event_id=f"cloud-session:{session_id}:{seq}:{event_type}",
    )


def _post_session_text(*, event_type: str, event_payload: dict[str, object]) -> str | None:
    if event_type == "item_completed":
        item = event_payload.get("item")
        if isinstance(item, dict) and item.get("kind") == "assistant_message":
            return _content_text(item)[:3000] or None
    if event_type == "session_ended":
        return "Session ended."
    if event_type == "turn_ended":
        return None
    if event_type == "interaction_requested":
        return "The agent needs input. Reply in this thread to continue."
    return None


def _content_text(item: dict[str, object]) -> str:
    parts = item.get("contentParts")
    if not isinstance(parts, list):
        return ""
    texts: list[str] = []
    for part in parts:
        if (
            isinstance(part, dict)
            and part.get("type") == "text"
            and isinstance(part.get("text"), str)
        ):
            texts.append(part["text"])
    return "".join(texts).strip()


def _workspace_url(cloud_workspace_id: UUID | None) -> str | None:
    if cloud_workspace_id is None or not settings.frontend_base_url:
        return None
    return f"{settings.frontend_base_url.rstrip('/')}/cloud/workspaces/{cloud_workspace_id}"
