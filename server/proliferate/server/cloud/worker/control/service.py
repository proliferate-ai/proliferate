"""Long-poll worker control service."""

from __future__ import annotations

import asyncio
from time import perf_counter

from proliferate.integrations.pubsub.redis import get_pubsub_bus
from proliferate.server.cloud.event_logging import log_cloud_event
from proliferate.server.cloud.live.domain.channels import worker_control_channel
from proliferate.server.cloud.worker.control.checks import (
    check_worker_control,
    timeout_response,
)
from proliferate.server.cloud.worker.models import (
    WorkerControlWaitRequest,
    WorkerControlWaitResponse,
)

_CONTROL_WAIT_DEFAULT_SECONDS = 20
_CONTROL_WAIT_MAX_SECONDS = 20
_CONTROL_WAIT_MIN_SECONDS = 1
_worker_control_bus = get_pubsub_bus()


async def wait_for_worker_control(
    *,
    body: WorkerControlWaitRequest,
    authorization: str | None,
) -> WorkerControlWaitResponse:
    started = perf_counter()
    wait_seconds = _clamp_wait_seconds(body.wait_seconds)
    first = await check_worker_control(
        body=body,
        authorization=authorization,
        timeout_response=False,
    )
    if first.response is not None or wait_seconds <= 0:
        response = first.response or await timeout_response(
            body=body,
            authorization=authorization,
        )
        _log_control_wait_response(response, wait_seconds=wait_seconds, started=started)
        return response

    channel = worker_control_channel(target_id=first.target_id)
    async with _worker_control_bus.subscribe(channel) as messages:
        recheck = await check_worker_control(
            body=body,
            authorization=authorization,
            timeout_response=False,
        )
        if recheck.response is not None:
            _log_control_wait_response(
                recheck.response,
                wait_seconds=wait_seconds,
                started=started,
            )
            return recheck.response

        deadline = asyncio.get_running_loop().time() + wait_seconds
        while True:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                break
            try:
                await asyncio.wait_for(anext(messages), timeout=remaining)
            except StopAsyncIteration:
                break
            except TimeoutError:
                break
            update = await check_worker_control(
                body=body,
                authorization=authorization,
                timeout_response=False,
            )
            if update.response is not None:
                _log_control_wait_response(
                    update.response,
                    wait_seconds=wait_seconds,
                    started=started,
                )
                return update.response

    response = await timeout_response(body=body, authorization=authorization)
    _log_control_wait_response(response, wait_seconds=wait_seconds, started=started)
    return response


def _clamp_wait_seconds(value: int | None) -> int:
    if value is None:
        return _CONTROL_WAIT_DEFAULT_SECONDS
    return max(_CONTROL_WAIT_MIN_SECONDS, min(_CONTROL_WAIT_MAX_SECONDS, value))


def _log_control_wait_response(
    response: WorkerControlWaitResponse,
    *,
    wait_seconds: int,
    started: float,
) -> None:
    log_cloud_event(
        "cloud worker control wait completed",
        reason=response.reason,
        wait_seconds=wait_seconds,
        elapsed_ms=int((perf_counter() - started) * 1000),
        has_command=response.command is not None,
        exposure_count=len(response.exposures) if response.exposures is not None else None,
    )
