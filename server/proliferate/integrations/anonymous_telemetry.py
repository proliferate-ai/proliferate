from __future__ import annotations

import asyncio
import logging
import platform
from contextlib import suppress
from importlib import metadata

import httpx

from proliferate.config import settings
from proliferate.db import engine as db_engine
from proliferate.integrations.sentry import capture_server_sentry_exception
from proliferate.server.anonymous_telemetry import service as telemetry_service
from proliferate.utils.telemetry_mode import (
    get_server_telemetry_mode,
    is_anonymous_telemetry_enabled,
)

logger = logging.getLogger(__name__)

_VERSION_INTERVAL_SECONDS = 24 * 60 * 60
_SURFACE = "server"


def _server_version() -> str:
    try:
        return metadata.version("proliferate-server")
    except metadata.PackageNotFoundError:
        return "0.1.0"


def _version_payload() -> telemetry_service.VersionPayload:
    return telemetry_service.VersionPayload(
        app_version=_server_version(),
        platform=platform.system().lower() or "unknown",
        arch=platform.machine().lower() or "unknown",
    )


async def _build_server_event() -> telemetry_service.AnonymousTelemetryEvent:
    return telemetry_service.AnonymousTelemetryEvent(
        install_uuid=await telemetry_service.load_or_create_local_install_id(_SURFACE),
        surface=_SURFACE,
        telemetry_mode=get_server_telemetry_mode(),
        record_type="VERSION",
        payload=_version_payload(),
    )


async def _post_remote_event(event: telemetry_service.AnonymousTelemetryEvent) -> None:
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.post(
            settings.anonymous_telemetry_endpoint,
            json={
                "installUuid": str(event.install_uuid),
                "surface": event.surface,
                "telemetryMode": event.telemetry_mode,
                "recordType": event.record_type,
                "payload": {
                    "appVersion": event.payload.app_version,
                    "platform": event.payload.platform,
                    "arch": event.payload.arch,
                },
            },
        )
        response.raise_for_status()


async def record_anonymous_telemetry(event: telemetry_service.AnonymousTelemetryEvent) -> None:
    async with db_engine.async_session_factory() as db, db.begin():
        await telemetry_service.record_anonymous_telemetry(db, event)


async def emit_server_anonymous_version() -> None:
    if not is_anonymous_telemetry_enabled():
        return

    event = await _build_server_event()
    if event.telemetry_mode == "hosted_product":
        await record_anonymous_telemetry(event)
        return

    await _post_remote_event(event)


async def _emit_with_capture(action: str, message: str) -> None:
    try:
        await emit_server_anonymous_version()
    except Exception as exc:
        capture_server_sentry_exception(
            exc,
            tags={
                "domain": "anonymous_telemetry",
                "action": action,
            },
        )
        logger.exception(message)


async def _sender_loop() -> None:
    await _emit_with_capture(
        "heartbeat_start",
        "Failed to emit initial anonymous server telemetry heartbeat",
    )

    while True:
        await asyncio.sleep(_VERSION_INTERVAL_SECONDS)
        await _emit_with_capture(
            "heartbeat_loop",
            "Failed to emit anonymous server telemetry heartbeat",
        )


async def start_server_anonymous_telemetry_sender() -> asyncio.Task[None] | None:
    if not is_anonymous_telemetry_enabled():
        return None

    return asyncio.create_task(
        _sender_loop(),
        name="anonymous-server-telemetry-heartbeat",
    )


async def stop_server_anonymous_telemetry_sender(
    task: asyncio.Task[None] | None,
) -> None:
    if task is None:
        return

    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
