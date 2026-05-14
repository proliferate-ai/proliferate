"""Redis-shaped pub/sub integration.

The launch implementation uses a process-local bus behind the same contract.
Swapping this module to a real Redis/NATS backend should not change cloud live
services or endpoint code.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from proliferate.integrations.pubsub.models import PubSubBus, PubSubMessage

SUBSCRIBER_QUEUE_SIZE = 100


class InProcessPubSubBus:
    """Process-local live fanout with bounded subscriber queues."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._subscribers: dict[str, set[asyncio.Queue[PubSubMessage]]] = defaultdict(set)

    @asynccontextmanager
    async def subscribe(self, channel: str) -> AsyncIterator[AsyncIterator[PubSubMessage]]:
        queue: asyncio.Queue[PubSubMessage] = asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_SIZE)
        async with self._lock:
            self._subscribers[channel].add(queue)
        try:
            yield _queue_iterator(queue)
        finally:
            async with self._lock:
                subscribers = self._subscribers.get(channel)
                if subscribers is not None:
                    subscribers.discard(queue)
                    if not subscribers:
                        self._subscribers.pop(channel, None)

    async def publish(self, channel: str, message: PubSubMessage) -> None:
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


async def _queue_iterator(queue: asyncio.Queue[PubSubMessage]) -> AsyncIterator[PubSubMessage]:
    while True:
        yield await queue.get()


_bus = InProcessPubSubBus()


def get_pubsub_bus() -> PubSubBus:
    return _bus
