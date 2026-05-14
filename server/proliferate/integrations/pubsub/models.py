"""Shared pub/sub integration types."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class PubSubMessage:
    event: str
    event_id: str
    data: dict[str, object]


class PubSubBus(Protocol):
    def subscribe(
        self,
        channel: str,
    ) -> AbstractAsyncContextManager[AsyncIterator[PubSubMessage]]:
        """Subscribe to a live channel."""

    async def publish(self, channel: str, message: PubSubMessage) -> None:
        """Publish a live message to a channel."""
