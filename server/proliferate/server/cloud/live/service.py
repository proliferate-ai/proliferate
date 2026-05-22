"""Cloud live session fanout and SSE stream helpers."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import engine as db_engine
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import events as events_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.integrations.pubsub.models import PubSubMessage
from proliferate.integrations.pubsub.redis import get_pubsub_bus
from proliferate.server.cloud.commands.models import command_response_payload
from proliferate.server.cloud.events.models import (
    CloudSessionEventResponse,
    CloudSessionPatchResponse,
    CloudSessionSnapshotResponse,
    WorkerSessionEventEnvelope,
    pending_interaction_response,
    session_event_response,
    session_patch_response,
    session_projection_response,
    transcript_item_response,
)
from proliferate.server.cloud.live.domain.channels import (
    session_channel,
    target_channel,
    workspace_channel,
)
from proliferate.server.cloud.live.domain.rules import clamp_live_cursor
from proliferate.server.cloud.live.models import (
    CloudCommandStatusEnvelope,
    CloudLivePatchEnvelope,
    CloudSessionEventsResponse,
    CloudStreamHeartbeatResponse,
    CloudTargetPatchEnvelope,
    CloudTargetSnapshotResponse,
    CloudTranscriptSnapshotResponse,
    CloudWorkspacePatchEnvelope,
    CloudWorkspaceSnapshotResponse,
    transcript_snapshot_response,
)
from proliferate.server.cloud.targets.models import target_detail_payload
from proliferate.server.cloud.workspaces.models import WorkspaceDetail
from proliferate.utils.time import utcnow

STREAM_HEARTBEAT_SECONDS = 15.0
_live_bus = get_pubsub_bus()
_last_live_event_id = 0
_live_publish_session: ContextVar[AsyncSession | None] = ContextVar(
    "cloud_live_publish_session",
    default=None,
)

type LivePublishCallback = Callable[[], Awaitable[None]]


async def publish_session_patch(patch: CloudSessionPatchResponse) -> None:
    db = _live_publish_session.get()
    if db is not None:
        await _publish_live_after_commit(db, lambda: _publish_session_patch_now(patch))
        return
    await _publish_session_patch_now(patch)


async def _publish_session_patch_now(patch: CloudSessionPatchResponse) -> None:
    await _live_bus.publish(
        session_channel(target_id=UUID(patch.target_id), session_id=patch.session_id),
        PubSubMessage(
            event="patch",
            event_id=str(patch.seq),
            data=CloudLivePatchEnvelope(
                patch=patch.model_dump(by_alias=True),
            ).model_dump(by_alias=True),
        ),
    )
    workspace_id = patch.session.cloud_workspace_id
    if workspace_id is not None:
        await _live_bus.publish(
            workspace_channel(workspace_id=UUID(workspace_id)),
            PubSubMessage(
                event="patch",
                event_id=_live_event_id(),
                data=CloudWorkspacePatchEnvelope(
                    patch=patch.model_dump(by_alias=True),
                ).model_dump(by_alias=True),
            ),
        )


@contextmanager
def defer_live_publishes_until_commit(db: AsyncSession) -> Iterator[None]:
    token = _live_publish_session.set(db)
    try:
        yield
    finally:
        _live_publish_session.reset(token)


async def publish_target_patch_after_commit(
    db: AsyncSession,
    target: targets_store.CloudTargetSnapshot,
) -> None:
    await _publish_live_after_commit(db, lambda: publish_target_patch(target))


async def publish_command_status_after_commit(
    db: AsyncSession,
    command: commands_store.CloudCommandSnapshot,
) -> None:
    await _publish_live_after_commit(db, lambda: publish_command_status(command))


async def publish_target_patch(target: targets_store.CloudTargetSnapshot) -> None:
    detail = target_detail_payload(target)
    await _live_bus.publish(
        target_channel(target_id=target.id),
        PubSubMessage(
            event="patch",
            event_id=_live_event_id(),
            data=CloudTargetPatchEnvelope(target=detail).model_dump(by_alias=True),
        ),
    )


async def publish_command_status(command: commands_store.CloudCommandSnapshot) -> None:
    data = CloudCommandStatusEnvelope(
        command=command_response_payload(command),
    ).model_dump(by_alias=True)
    event_id = _live_event_id()
    await _live_bus.publish(
        target_channel(target_id=command.target_id),
        PubSubMessage(event="command_status", event_id=event_id, data=data),
    )
    if command.session_id is not None:
        await _live_bus.publish(
            session_channel(target_id=command.target_id, session_id=command.session_id),
            PubSubMessage(event="command_status", event_id=event_id, data=data),
        )


async def _publish_live_after_commit(
    db: AsyncSession,
    callback: LivePublishCallback,
) -> None:
    await db_engine.run_after_commit(db, callback)


async def stream_session_events(
    *,
    target_id: UUID,
    session_id: str,
    after_seq: int,
) -> AsyncIterator[str]:
    cursor = clamp_live_cursor(after_seq)
    channel = session_channel(target_id=target_id, session_id=session_id)
    async with _live_bus.subscribe(channel) as messages:
        async with db_engine.async_session_factory() as stream_db:
            snapshot = await _get_session_snapshot(
                stream_db,
                target_id=target_id,
                session_id=session_id,
            )
        cursor = max(cursor, snapshot.session.last_event_seq)
        yield _sse_event(
            event="snapshot",
            event_id=str(cursor),
            data=snapshot.model_dump(by_alias=True),
        )

        while True:
            try:
                message = await asyncio.wait_for(
                    anext(messages),
                    timeout=STREAM_HEARTBEAT_SECONDS,
                )
            except StopAsyncIteration:
                return
            except TimeoutError:
                yield _sse_event(
                    event="heartbeat",
                    event_id=str(cursor),
                    data=CloudStreamHeartbeatResponse().model_dump(by_alias=True),
                )
                continue
            message_seq = _int_or_zero(message.event_id)
            if message_seq <= cursor:
                continue
            cursor = message_seq
            yield _sse_event(
                event=message.event,
                event_id=message.event_id,
                data=message.data,
            )


async def stream_workspace_events(
    *,
    workspace: WorkspaceDetail,
    after_seq: int,
) -> AsyncIterator[str]:
    cursor = clamp_live_cursor(after_seq)
    workspace_id = UUID(workspace.id)
    channel = workspace_channel(workspace_id=workspace_id)
    async with _live_bus.subscribe(channel) as messages:
        async with db_engine.async_session_factory() as stream_db:
            snapshot = await _get_workspace_snapshot(
                stream_db,
                workspace=workspace,
            )
        cursor = max(
            cursor,
            max((session.last_event_seq for session in snapshot.sessions), default=0),
        )
        yield _sse_event(
            event="snapshot",
            event_id=str(cursor),
            data=snapshot.model_dump(by_alias=True),
        )

        while True:
            try:
                message = await asyncio.wait_for(
                    anext(messages),
                    timeout=STREAM_HEARTBEAT_SECONDS,
                )
            except StopAsyncIteration:
                return
            except TimeoutError:
                yield _sse_event(
                    event="heartbeat",
                    event_id=str(cursor),
                    data=CloudStreamHeartbeatResponse().model_dump(by_alias=True),
                )
                continue
            message_seq = _int_or_zero(message.event_id)
            if message_seq <= cursor:
                continue
            cursor = message_seq
            yield _sse_event(
                event=message.event,
                event_id=message.event_id,
                data=message.data,
            )


async def stream_target_events(
    *,
    target_id: UUID,
    after_seq: int,
) -> AsyncIterator[str]:
    cursor = clamp_live_cursor(after_seq)
    channel = target_channel(target_id=target_id)
    async with _live_bus.subscribe(channel) as messages:
        async with db_engine.async_session_factory() as stream_db:
            snapshot = await _get_target_snapshot(stream_db, target_id=target_id)
        yield _sse_event(
            event="snapshot",
            event_id=str(cursor),
            data=snapshot.model_dump(by_alias=True),
        )

        while True:
            try:
                message = await asyncio.wait_for(
                    anext(messages),
                    timeout=STREAM_HEARTBEAT_SECONDS,
                )
            except StopAsyncIteration:
                return
            except TimeoutError:
                yield _sse_event(
                    event="heartbeat",
                    event_id=str(cursor),
                    data=CloudStreamHeartbeatResponse().model_dump(by_alias=True),
                )
                continue
            message_seq = _int_or_zero(message.event_id)
            if message_seq <= cursor:
                continue
            cursor = message_seq
            yield _sse_event(
                event=message.event,
                event_id=message.event_id,
                data=message.data,
            )


async def _get_session_snapshot(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
) -> CloudSessionSnapshotResponse:
    projection = await events_store.get_session_projection(
        db,
        target_id=target_id,
        session_id=session_id,
    )
    if projection is None:
        raise LookupError("Synced session not found.")
    transcript_items = await events_store.list_transcript_items(
        db,
        target_id=target_id,
        session_id=session_id,
    )
    pending_interactions = await events_store.list_pending_interactions(
        db,
        target_id=target_id,
        session_id=session_id,
    )
    return CloudSessionSnapshotResponse(
        session=session_projection_response(projection),
        transcript_items=[transcript_item_response(item) for item in transcript_items],
        pending_interactions=[
            pending_interaction_response(interaction) for interaction in pending_interactions
        ],
    )


async def get_transcript_snapshot(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
) -> CloudTranscriptSnapshotResponse:
    return transcript_snapshot_response(
        await _get_session_snapshot(db, target_id=target_id, session_id=session_id)
    )


async def get_workspace_snapshot(
    db: AsyncSession,
    *,
    workspace: WorkspaceDetail,
) -> CloudWorkspaceSnapshotResponse:
    return await _get_workspace_snapshot(db, workspace=workspace)


async def list_session_events_after(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
    after_seq: int,
    limit: int,
) -> CloudSessionEventsResponse:
    events = await events_store.list_events_after(
        db,
        target_id=target_id,
        session_id=session_id,
        after_seq=clamp_live_cursor(after_seq),
        limit=min(max(limit, 1), 200),
    )
    event_responses: list[CloudSessionEventResponse] = [
        session_event_response(event) for event in events
    ]
    next_cursor = event_responses[-1].seq if event_responses else None
    return CloudSessionEventsResponse(
        events=event_responses,
        next_cursor=next_cursor,
    )


async def _get_workspace_snapshot(
    db: AsyncSession,
    *,
    workspace: WorkspaceDetail,
) -> CloudWorkspaceSnapshotResponse:
    sessions = await events_store.list_session_projections_for_workspace(
        db,
        cloud_workspace_id=UUID(workspace.id),
    )
    return CloudWorkspaceSnapshotResponse(
        workspace=workspace,
        sessions=[session_projection_response(session) for session in sessions],
    )


async def _get_target_snapshot(
    db: AsyncSession,
    *,
    target_id: UUID,
) -> CloudTargetSnapshotResponse:
    target = await targets_store.get_target_by_id(db, target_id)
    if target is None:
        raise LookupError("Target not found.")
    return CloudTargetSnapshotResponse(target=target_detail_payload(target))


def projection_patch_from_event(
    *,
    target_id: UUID,
    session_id: str,
    seq: int,
    event_type: str,
    session: events_store.CloudSessionProjectionSnapshot,
    transcript_item: events_store.CloudTranscriptItemSnapshot | None = None,
    pending_interaction: events_store.CloudPendingInteractionSnapshot | None = None,
    envelope: WorkerSessionEventEnvelope | None = None,
) -> CloudSessionPatchResponse:
    return session_patch_response(
        target_id=target_id,
        session_id=session_id,
        seq=seq,
        event_type=event_type,
        session=session,
        transcript_item=transcript_item,
        pending_interaction=pending_interaction,
        envelope=envelope,
    )


def _sse_event(*, event: str, event_id: str, data: object) -> str:
    encoded = json.dumps(data, separators=(",", ":"), sort_keys=True)
    return f"id: {event_id}\nevent: {event}\ndata: {encoded}\n\n"


def _live_event_id() -> str:
    global _last_live_event_id
    timestamp_ms = int(utcnow().timestamp() * 1000)
    _last_live_event_id = max(timestamp_ms, _last_live_event_id + 1)
    return str(_last_live_event_id)


def _int_or_zero(value: str) -> int:
    try:
        return int(value)
    except ValueError:
        return 0
