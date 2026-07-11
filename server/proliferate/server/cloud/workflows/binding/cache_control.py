"""Cache hardening for materialization-only workflow identity routes."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from starlette.datastructures import MutableHeaders


class WorkflowBindingNoStoreMiddleware:
    """Stamp ``Cache-Control: no-store`` on every offer/accept/status response.

    This wraps the ASGI response start event, so dependency failures, request
    validation errors, and domain errors receive the same protection as 2xx
    responses that carry the one-time materialization credential.
    """

    def __init__(self, app: Callable[..., Awaitable[None]]) -> None:
        self.app = app

    async def __call__(
        self,
        scope: dict[str, Any],
        receive: Callable[..., Awaitable[dict[str, Any]]],
        send: Callable[[dict[str, Any]], Awaitable[None]],
    ) -> None:
        path = str(scope.get("path", ""))
        protected = scope.get("type") == "http" and (
            path.endswith("/materialization-offer") or path.endswith("/execution-binding")
        )
        if not protected:
            await self.app(scope, receive, send)
            return

        async def send_no_store(message: dict[str, Any]) -> None:
            if message.get("type") == "http.response.start":
                MutableHeaders(scope=message)["Cache-Control"] = "no-store"
            await send(message)

        await self.app(scope, receive, send_no_store)
