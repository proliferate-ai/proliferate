from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace
import uuid

import pytest

from proliferate.server.cloud.agent_auth import grant_freshness
from proliferate.utils.time import utcnow


@pytest.mark.asyncio
async def test_runtime_grant_freshness_refreshes_stale_revision_without_restart(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sandbox_profile_id = uuid.uuid4()
    target_id = uuid.uuid4()
    grant = SimpleNamespace(
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        issued_profile_revision=1,
        expires_at=utcnow() + timedelta(hours=6),
    )
    profile = SimpleNamespace(
        id=sandbox_profile_id,
        primary_target_id=target_id,
        agent_auth_revision=2,
    )
    queued: list[dict[str, object]] = []

    async def list_runtime_grants_needing_rotation(*args: object, **kwargs: object):
        return (grant,)

    async def get_sandbox_profile(*args: object, **kwargs: object):
        return profile

    async def mark_pending(*args: object, **kwargs: object) -> None:
        queued.append(kwargs)

    monkeypatch.setattr(grant_freshness.settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(
        grant_freshness.store,
        "list_runtime_grants_needing_rotation",
        list_runtime_grants_needing_rotation,
    )
    monkeypatch.setattr(
        grant_freshness.store,
        "get_sandbox_profile",
        get_sandbox_profile,
    )
    monkeypatch.setattr(
        grant_freshness,
        "_mark_target_pending_and_queue_refresh",
        mark_pending,
    )

    result = await grant_freshness.reconcile_agent_gateway_runtime_grant_freshness(
        object(),
    )

    assert result.grants_checked == 1
    assert result.targets_refreshed == 1
    assert result.grants_skipped == 0
    assert queued == [
        {
            "profile": profile,
            "actor_user_id": None,
            "reason": "runtime_grant_expiring",
            "force_restart": False,
        }
    ]
