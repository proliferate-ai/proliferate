"""Cloud live session fanout and SSE stream helpers."""

from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import engine as db_engine
from proliferate.db.store.cloud_sync import events as events_store
from proliferate.server.cloud.events.models import (
    CloudSessionPatchResponse,
    CloudSessionSnapshotResponse,
    pending_interaction_response,
    session_patch_response,
    session_projection_response,
    transcript_item_response,
)
from proliferate.server.cloud.live.domain.channels import session_channel
from proliferate.server.cloud.live.models import (
    CloudLivePatchEnvelope,
    CloudStreamHeartbeatResponse,
)

STREAM_HEARTBEAT_SECONDS = 15.0
SUBSCRIBER_QUEUE_SIZE = 100


@dataclass(frozen=True)
class LiveMessage:
    event: str
    event_id: str
    data: dict[str, object]


class InProcessLiveBus:
    """Process-local live fanout.

    This is intentionally behind a tiny publish/subscribe boundary so Redis,
    NATS, or an actor implementation can replace it without changing the
    session/event services.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._subscribers: dict[str, set[asyncio.Queue[LiveMessage]]] = defaultdict(set)

    @asynccontextmanager
    async def subscribe(self, channel: str) -> AsyncIterator[asyncio.Queue[LiveMessage]]:
        queue: asyncio.Queue[LiveMessage] = asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_SIZE)
        async with self._lock:
            self._subscribers[channel].add(queue)
        try:
            yield queue
        finally:
            async with self._lock:
                subscribers = self._subscribers.get(channel)
                if subscribers is not None:
                    subscribers.discard(queue)
                    if not subscribers:
                        self._subscribers.pop(channel, None)

    async def publish(self, channel: str, message: LiveMessage) -> None:
        async with self._lock:
            subscribers = tuple(self._subscribers.get(channel, ()))
        for queue in subscribers:
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                with suppress(asyncio.QueueEmpty):
                    queue.get_nowait()
                with suppress(asyncio.QueueFull):
                    queue.put_nowait(message)


_live_bus = InProcessLiveBus()


async def publish_session_patch(patch: CloudSessionPatchResponse) -> None:
    await _live_bus.publish(
        session_channel(target_id=UUID(patch.target_id), session_id=patch.session_id),
        LiveMessage(
            event="patch",
            event_id=str(patch.seq),
            data=CloudLivePatchEnvelope(
                patch=patch.model_dump(by_alias=True),
            ).model_dump(by_alias=True),
        ),
    )


async def stream_session_events(
    *,
    target_id: UUID,
    session_id: str,
    after_seq: int,
) -> AsyncIterator[str]:
    cursor = max(0, after_seq)
    channel = session_channel(target_id=target_id, session_id=session_id)
    async with _live_bus.subscribe(channel) as queue:
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
                    queue.get(),
                    timeout=STREAM_HEARTBEAT_SECONDS,
                )
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


def projection_patch_from_event(
    *,
    target_id: UUID,
    session_id: str,
    seq: int,
    event_type: str,
    session: events_store.CloudSessionProjectionSnapshot,
    transcript_item: events_store.CloudTranscriptItemSnapshot | None = None,
    pending_interaction: events_store.CloudPendingInteractionSnapshot | None = None,
) -> CloudSessionPatchResponse:
    return session_patch_response(
        target_id=target_id,
        session_id=session_id,
        seq=seq,
        event_type=event_type,
        session=session,
        transcript_item=transcript_item,
        pending_interaction=pending_interaction,
    )


def _sse_event(*, event: str, event_id: str, data: object) -> str:
    encoded = json.dumps(data, separators=(",", ":"), sort_keys=True)
    return f"id: {event_id}\nevent: {event}\ndata: {encoded}\n\n"


def _int_or_zero(value: str) -> int:
    try:
        return int(value)
    except ValueError:
        return 0
