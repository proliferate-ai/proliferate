from __future__ import annotations

import asyncio
import logging
import platform
from contextlib import suppress
from importlib import metadata

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import engine as db_engine
from proliferate.integrations import anonymous_telemetry as anonymous_telemetry_client
from proliferate.integrations.sentry import capture_server_sentry_exception
from proliferate.server.anonymous_telemetry.service import (
    AnonymousTelemetryEvent,
    TelemetrySurface,
    VersionPayload,
    load_or_create_local_install_id,
    record_anonymous_telemetry,
)
from proliferate.utils.telemetry_mode import (
    get_server_telemetry_mode,
    is_anonymous_telemetry_enabled,
)

logger = logging.getLogger(__name__)

_VERSION_INTERVAL_SECONDS = 24 * 60 * 60
_SURFACE: TelemetrySurface = "server"


def _server_version() -> str:
    try:
        return metadata.version("proliferate-server")
    except metadata.PackageNotFoundError:
        return "0.1.0"


def _version_payload() -> VersionPayload:
    return VersionPayload(
        app_version=_server_version(),
        platform=platform.system().lower() or "unknown",
        arch=platform.machine().lower() or "unknown",
    )


async def _build_server_event(db: AsyncSession) -> AnonymousTelemetryEvent:
    return AnonymousTelemetryEvent(
        install_uuid=await load_or_create_local_install_id(db, _SURFACE),
        surface=_SURFACE,
        telemetry_mode=get_server_telemetry_mode(),
        record_type="VERSION",
        payload=_version_payload(),
    )


def _remote_payload(event: AnonymousTelemetryEvent) -> dict[str, object]:
    if not isinstance(event.payload, VersionPayload):
        raise ValueError("server anonymous telemetry heartbeat must use a version payload")

    return {
        "installUuid": str(event.install_uuid),
        "surface": event.surface,
        "telemetryMode": event.telemetry_mode,
        "recordType": event.record_type,
        "payload": {
            "appVersion": event.payload.app_version,
            "platform": event.payload.platform,
            "arch": event.payload.arch,
        },
    }


async def emit_server_anonymous_version() -> None:
    if not is_anonymous_telemetry_enabled():
        return

    async with db_engine.async_session_factory() as db, db.begin():
        event = await _build_server_event(db)
        if event.telemetry_mode == "hosted_product":
            await record_anonymous_telemetry(db, event)
            return

    await anonymous_telemetry_client.post_anonymous_telemetry_payload(_remote_payload(event))


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
