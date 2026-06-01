from __future__ import annotations

import logging
from uuid import uuid4

import pytest

from proliferate.server.cloud.commands import agent_auth_refresh


class _FailingRefreshTransaction:
    async def __aenter__(self) -> object:
        return object()

    async def __aexit__(
        self,
        _exc_type: object,
        _exc: object,
        _traceback: object,
    ) -> bool:
        return False


@pytest.mark.asyncio
async def test_agent_auth_refresh_failure_logs_warning_without_raising(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    log_calls: list[tuple[str, int]] = []

    async def _request_refresh(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("refresh failed")

    def _log_cloud_event(message: str, *, level: int = logging.INFO, **_fields: object) -> None:
        log_calls.append((message, level))

    monkeypatch.setattr(
        agent_auth_refresh.db_session,
        "open_async_transaction",
        _FailingRefreshTransaction,
    )
    monkeypatch.setattr(
        agent_auth_refresh,
        "request_agent_auth_refresh_for_profile_target",
        _request_refresh,
    )
    monkeypatch.setattr(agent_auth_refresh, "log_cloud_event", _log_cloud_event)

    await agent_auth_refresh.queue_agent_auth_refresh_for_not_ready_preflight(
        sandbox_profile_id=uuid4(),
        target_id=uuid4(),
        actor_user_id=uuid4(),
    )

    assert log_calls == [
        (
            "cloud command preflight agent auth refresh request failed",
            logging.WARNING,
        )
    ]
