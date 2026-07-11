"""Accepted bindings are never silently transferred by local reclaim."""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import cloud_workflows as workflow_store
from proliferate.server.cloud.workflows.binding.service import (
    accept_execution_binding,
    issue_materialization_offer,
)
from proliferate.utils.time import utcnow
from tests.unit.test_workflow_binding_identity import (
    _binding,
    _identity_run,
    _local_actor,
    _request,
)

pytestmark = pytest.mark.asyncio


async def test_expired_bound_local_run_is_parked_not_reclaimed(
    db_session: AsyncSession,
) -> None:
    user, run = await _identity_run(db_session)
    actor = await _local_actor(db_session, user.id)
    offer = await issue_materialization_offer(
        db_session,
        actor,
        run_id=run.id,
        executor_id="desktop-1",
        claim_id=run.claim_id,
    )
    await accept_execution_binding(
        db_session,
        actor,
        run_id=run.id,
        request=_request(offer, _binding(executor_id="desktop-1")),
        materialization_credential=offer.materialization_credential,
    )
    original_claim_id = run.claim_id
    original_generation = run.claim_generation
    run.claim_expires_at = utcnow() - timedelta(seconds=1)
    await db_session.flush()

    reclaimed = await workflow_store.claim_local_workflow_runs(
        db_session,
        user_id=user.id,
        executor_id="desktop-2",
        workspace_id="desktop-ws-1",
        workspace_generation=2,
        claim_ttl=timedelta(minutes=5),
        limit=1,
        now=utcnow(),
    )

    assert reclaimed == ()
    await db_session.refresh(run)
    assert run.executor_id == "desktop-1"
    assert run.claim_id == original_claim_id
    assert run.claim_generation == original_generation
    assert run.binding_hash is not None
    assert run.execution_generation == 1
    assert run.execution_binding_json is not None
