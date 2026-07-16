"""The worker-sidecar launch surfaces a missing cloud base URL (T1).

Regression (qualification findings ledger, filed 2026-07-15): a deploy with
neither ``CLOUD_WORKER_BASE_URL`` nor ``API_BASE_URL`` set made
``launch_worker_sidecar`` return silently — the sandbox booted with no worker
(no enrollment, no heartbeat, no integration gateway) and nothing surfaced the
misconfiguration. The skip must now emit a WARNING naming the sandbox and the
env vars to set, while still skipping the launch (sidecar boot stays
best-effort: no exception, no enrollment mint).

The spy targets ``log_cloud_event`` rather than caplog because the
``proliferate`` app logger sets ``propagate = False``
(``proliferate/utils/logging.py``), so its records never reach caplog's root
handler.
"""

from __future__ import annotations

import logging
import uuid
from types import SimpleNamespace
from typing import Any

import pytest

from proliferate.server.cloud.materialization.sandbox_io import worker_sidecar


def _sandbox_record() -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        owner_user_id=uuid.uuid4(),
        organization_id=None,
    )


def _spy_log(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, int, dict[str, Any]]]:
    events: list[tuple[str, int, dict[str, Any]]] = []

    def _capture(message: str, *, level: int = logging.INFO, **fields: Any) -> None:
        events.append((message, level, fields))

    monkeypatch.setattr(worker_sidecar, "log_cloud_event", _capture)
    return events


@pytest.mark.asyncio
async def test_missing_cloud_base_url_warns_and_skips(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(worker_sidecar, "worker_cloud_base_url", lambda: "")
    events = _spy_log(monkeypatch)

    async def _must_not_mint(*_a: Any, **_k: Any) -> str:
        raise AssertionError("no enrollment should be minted when the launch is skipped")

    monkeypatch.setattr(worker_sidecar, "mint_cloud_sandbox_worker_enrollment", _must_not_mint)

    sandbox_record = _sandbox_record()
    await worker_sidecar.launch_worker_sidecar(
        provider=SimpleNamespace(),  # type: ignore[arg-type]
        provider_sandbox=object(),
        sandbox_record=sandbox_record,  # type: ignore[arg-type]
        runtime_context=SimpleNamespace(),  # type: ignore[arg-type]
    )

    assert len(events) == 1
    message, level, fields = events[0]
    assert level == logging.WARNING
    assert "cloud worker sidecar skipped" in message
    assert "CLOUD_WORKER_BASE_URL" in message
    assert "API_BASE_URL" in message
    assert fields["cloud_sandbox_id"] == str(sandbox_record.id)


@pytest.mark.asyncio
async def test_missing_owner_skips_without_base_url_warning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Ownerless records (defensive path) keep skipping quietly — the warning is
    # specifically about deployment misconfiguration, not per-record gaps.
    monkeypatch.setattr(worker_sidecar, "worker_cloud_base_url", lambda: "")
    events = _spy_log(monkeypatch)
    sandbox_record = _sandbox_record()
    sandbox_record.owner_user_id = None

    await worker_sidecar.launch_worker_sidecar(
        provider=SimpleNamespace(),  # type: ignore[arg-type]
        provider_sandbox=object(),
        sandbox_record=sandbox_record,  # type: ignore[arg-type]
        runtime_context=SimpleNamespace(),  # type: ignore[arg-type]
    )

    assert events == []
