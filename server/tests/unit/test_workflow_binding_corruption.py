"""Fail-closed persistence-corruption tests for workflow binding identity."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
import json
import uuid

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workflow_identity import WorkflowMaterializationOffer
from proliferate.db.models.cloud.workflows import WorkflowRun
from proliferate.db.store.workflow_ledger import bindings as binding_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.binding.service import (
    accept_execution_binding,
    issue_materialization_offer,
)
from proliferate.server.cloud.workflows.contracts.models import plan_hash as compute_plan_hash
from tests.unit.test_workflow_binding_identity import (
    _binding,
    _identity_run,
    _local_actor,
    _request,
)

pytestmark = pytest.mark.asyncio


@pytest.mark.parametrize(
    ("field", "replacement"),
    [
        pytest.param("run_id", lambda: str(uuid.uuid4()), id="run-id"),
        pytest.param("workflow_id", lambda: str(uuid.uuid4()), id="workflow-id"),
        pytest.param(
            "workflow_version_id",
            lambda: str(uuid.uuid4()),
            id="workflow-version-id",
        ),
        pytest.param("version_n", lambda: 2, id="version-number"),
        pytest.param("trigger_kind", lambda: "schedule", id="trigger-kind"),
        pytest.param("target_mode", lambda: "personal_cloud", id="target-mode"),
    ],
)
async def test_stored_plan_must_match_every_duplicated_run_ledger_identity(
    db_session: AsyncSession,
    field: str,
    replacement: Callable[[], object],
) -> None:
    user, run = await _identity_run(db_session)
    actor = await _local_actor(db_session, user.id)
    plan = dict(run.resolved_plan_json)
    plan[field] = replacement()
    plan["planHash"] = compute_plan_hash(plan)
    run.resolved_plan_json = plan
    run.plan_hash = plan["planHash"]  # type: ignore[assignment]
    await db_session.flush()

    with pytest.raises(CloudApiError) as caught:
        await issue_materialization_offer(
            db_session,
            actor,
            run_id=run.id,
            executor_id="desktop-1",
            claim_id=run.claim_id,
        )

    assert caught.value.status_code == 409
    assert caught.value.code == "workflow_plan_identity_incomplete"
    offers = await db_session.scalars(select(WorkflowMaterializationOffer.id))
    assert list(offers) == []


@pytest.mark.parametrize(
    ("corrupt", "expected_code"),
    [
        pytest.param(lambda _plan: [], "workflow_plan_identity_conflict", id="list"),
        pytest.param(lambda _plan: None, "workflow_plan_identity_conflict", id="null"),
        pytest.param(
            lambda plan: {**plan, "sessions": {"main": {"unsafe": 9_007_199_254_740_993}}},
            "workflow_plan_identity_incomplete",
            id="unsafe-integer",
        ),
    ],
)
async def test_corrupt_stored_plan_fails_closed_without_offer(
    db_session: AsyncSession,
    corrupt: Callable[[dict[str, object]], object],
    expected_code: str,
) -> None:
    user, run = await _identity_run(db_session)
    actor = await _local_actor(db_session, user.id)
    run.resolved_plan_json = corrupt(dict(run.resolved_plan_json))  # type: ignore[assignment]
    await db_session.flush()

    with pytest.raises(CloudApiError) as caught:
        await issue_materialization_offer(
            db_session,
            actor,
            run_id=run.id,
            executor_id="desktop-1",
            claim_id=run.claim_id,
        )

    assert caught.value.status_code == 409
    assert caught.value.code == expected_code
    offers = await db_session.scalars(select(WorkflowMaterializationOffer.id))
    assert list(offers) == []


@pytest.mark.parametrize(
    "corrupt",
    [
        pytest.param([], id="list"),
        pytest.param(None, id="null"),
        pytest.param({"unsafe": 9_007_199_254_740_993}, id="unsafe-integer"),
    ],
)
async def test_corrupt_committed_binding_retry_fails_closed(
    db_session: AsyncSession,
    corrupt: object,
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
    request = _request(offer, _binding(executor_id="desktop-1"))
    await accept_execution_binding(
        db_session,
        actor,
        run_id=run.id,
        request=request,
        materialization_credential=offer.materialization_credential,
    )
    await db_session.commit()
    stored = await db_session.get(WorkflowRun, run.id)
    assert stored is not None
    stored.execution_binding_json = corrupt  # type: ignore[assignment]
    await db_session.commit()

    with pytest.raises(CloudApiError) as caught:
        await accept_execution_binding(
            db_session,
            actor,
            run_id=run.id,
            request=request,
            materialization_credential=offer.materialization_credential,
        )
    assert caught.value.status_code == 409
    assert caught.value.code == "workflow_binding_identity_conflict"


async def test_request_lone_surrogate_is_translated_without_binding_mutation(
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
    raw = _binding(executor_id="desktop-1")
    raw["materializationId"] = json.loads('"\\ud800"')

    with pytest.raises(CloudApiError) as caught:
        await accept_execution_binding(
            db_session,
            actor,
            run_id=run.id,
            request=_request(offer, raw),
            materialization_credential=offer.materialization_credential,
        )
    assert caught.value.status_code == 400
    assert caught.value.code == "workflow_execution_binding_invalid"
    await db_session.refresh(run)
    assert run.binding_hash is None


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("workspaceId", " workspace-1"),
        ("workspaceId", "workspace 1"),
        ("materializationId", "materialization-1 "),
        ("executorId", "desktop\x00-1"),
        ("checkpointId", "checkpoint\n1"),
    ],
)
async def test_binding_identifiers_reject_whitespace_and_controls(
    db_session: AsyncSession,
    field: str,
    value: str,
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
    raw = _binding(executor_id="desktop-1")
    if field == "checkpointId":
        raw["sourceKind"] = "workspace_checkpoint"
        raw["checkpointContentHash"] = f"sha256:{'a' * 64}"
    raw[field] = value
    from proliferate.server.cloud.workflows.contracts.models import binding_hash

    raw["bindingHash"] = binding_hash(raw)
    with pytest.raises(CloudApiError) as caught:
        await accept_execution_binding(
            db_session,
            actor,
            run_id=run.id,
            request=_request(offer, raw),
            materialization_credential=offer.materialization_credential,
        )
    assert caught.value.code == "workflow_binding_identifier_invalid"
    await db_session.refresh(run)
    assert run.binding_hash is None


async def test_offer_consume_drift_rolls_back_run_binding_cas(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
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
    request = _request(offer, _binding(executor_id="desktop-1"))
    run_id = run.id
    offer_id = await db_session.scalar(
        select(WorkflowMaterializationOffer.id).where(
            WorkflowMaterializationOffer.workflow_run_id == run_id
        )
    )
    assert offer_id is not None
    await db_session.commit()
    original = binding_store.consume_offer

    async def drift_then_consume(*args: object, **kwargs: object) -> bool:
        session = args[0]
        assert isinstance(session, AsyncSession)
        await session.execute(
            update(WorkflowMaterializationOffer)
            .where(WorkflowMaterializationOffer.id == offer_id)
            .values(status="revoked")
        )
        return await original(*args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(binding_store, "consume_offer", drift_then_consume)
    with pytest.raises(CloudApiError) as caught:
        await accept_execution_binding(
            db_session,
            actor,
            run_id=run_id,
            request=request,
            materialization_credential=offer.materialization_credential,
        )
    assert caught.value.code == "workflow_offer_identity_conflict"
    await db_session.rollback()

    stored_run = await db_session.get(WorkflowRun, run_id)
    stored_offer = await db_session.get(WorkflowMaterializationOffer, offer_id)
    assert stored_run is not None and stored_run.binding_hash is None
    assert stored_offer is not None and stored_offer.status == "pending"


async def test_offer_disappearing_before_locked_read_is_typed(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
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

    async def disappeared(*_args: object, **_kwargs: object):  # type: ignore[no-untyped-def]
        return None

    monkeypatch.setattr(binding_store, "lock_offer_by_id", disappeared)
    with pytest.raises(CloudApiError) as caught:
        await accept_execution_binding(
            db_session,
            actor,
            run_id=run.id,
            request=_request(offer, _binding(executor_id="desktop-1")),
            materialization_credential=offer.materialization_credential,
        )
    assert caught.value.code == "workflow_materialization_credential_invalid"
    assert caught.value.status_code == 401
    await db_session.refresh(run)
    assert run.binding_hash is None


@pytest.mark.parametrize(
    "corruption",
    [
        {"credential_salt": "not-hex"},
        {"credential_hash": "not-hex"},
        {"audience": "wrong-audience"},
        {"status": "impossible"},
        {"expires_at": "not-a-datetime"},
    ],
    ids=["salt", "hash", "audience", "status", "time"],
)
async def test_corrupt_offer_credential_fields_fail_typed_without_mutation(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    corruption: dict[str, object],
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
    original_lock = binding_store.lock_offer_by_id

    async def corrupted(*args: object, **kwargs: object):  # type: ignore[no-untyped-def]
        current = await original_lock(*args, **kwargs)  # type: ignore[arg-type]
        assert current is not None
        return replace(current, **corruption)

    monkeypatch.setattr(binding_store, "lock_offer_by_id", corrupted)
    with pytest.raises(CloudApiError) as caught:
        await accept_execution_binding(
            db_session,
            actor,
            run_id=run.id,
            request=_request(offer, _binding(executor_id="desktop-1")),
            materialization_credential=offer.materialization_credential,
        )
    assert caught.value.code == "workflow_materialization_credential_invalid"
    assert caught.value.status_code == 401
    await db_session.refresh(run)
    stored_offer = await db_session.scalar(
        select(WorkflowMaterializationOffer).where(
            WorkflowMaterializationOffer.workflow_run_id == run.id
        )
    )
    assert run.binding_hash is None
    assert stored_offer is not None and stored_offer.status == "pending"
