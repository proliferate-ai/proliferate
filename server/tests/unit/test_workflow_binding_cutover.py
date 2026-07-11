"""Binding authority, exact-ACK recovery, and manual end-to-end cutover tests."""

from __future__ import annotations

import asyncio
import uuid

import pytest
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.db.models.cloud.workflow_identity import WorkflowMaterializationOffer
from proliferate.db.models.cloud.workflows import WorkflowRun
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.db.store import cloud_workflows as workflow_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows import compiler, local_executor
from proliferate.server.cloud.workflows.binding import service as binding_service
from proliferate.server.cloud.workflows.binding.access import BindingActor
from proliferate.server.cloud.workflows.binding.models import (
    AcceptExecutionBindingRequest,
    CreateMaterializationOfferRequest,
)
from proliferate.server.cloud.workflows.binding.service import (
    accept_execution_binding,
    issue_materialization_offer,
)
from proliferate.server.cloud.workflows.contracts.models import (
    binding_hash,
    plan_hash as compute_plan_hash,
)
from proliferate.server.cloud.workflows.domain.definition import parse_definition
from proliferate.server.cloud.workflows.local_models import LocalWorkflowClaimRequest
from tests.unit.test_workflow_binding_identity import (
    _binding,
    _cloud_binding,
    _cloud_identity_run,
    _identity_run,
    _local_actor,
    _request,
)
from tests.unit.workflow_ledger_helpers import make_user

pytestmark = pytest.mark.asyncio


async def test_binding_models_reject_boolean_integer_smuggling() -> None:
    with pytest.raises(ValidationError):
        AcceptExecutionBindingRequest.model_validate(
            {
                "schemaVersion": 1,
                "executionGeneration": True,
                "executorFence": "fence",
                "binding": {},
            }
        )


async def test_binding_request_models_accept_only_canonical_wire_aliases() -> None:
    with pytest.raises(ValidationError):
        CreateMaterializationOfferRequest.model_validate({"executor_id": "desktop-1"})
    canonical_claim_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    request = CreateMaterializationOfferRequest.model_validate(
        {"executorId": "desktop-1", "claimId": canonical_claim_id}
    )
    assert request.claim_id == canonical_claim_id
    for invalid_claim_id in (
        canonical_claim_id.upper(),
        canonical_claim_id.replace("-", ""),
        f" {canonical_claim_id}",
    ):
        with pytest.raises(ValidationError):
            CreateMaterializationOfferRequest.model_validate(
                {"executorId": "desktop-1", "claimId": invalid_claim_id}
            )
    with pytest.raises(ValidationError):
        CreateMaterializationOfferRequest.model_validate(
            {"executorId": "desktop-1", "claimId": uuid.UUID(canonical_claim_id)}
        )
    with pytest.raises(ValidationError):
        AcceptExecutionBindingRequest.model_validate(
            {
                "schema_version": 1,
                "execution_generation": 1,
                "executor_fence": "fence",
                "binding": {},
            }
        )


async def test_cloud_offer_rejects_wrong_same_owner_sandbox_identity(
    db_session: AsyncSession,
) -> None:
    user, run, _sandbox, worker = await _cloud_identity_run(db_session)
    stale = BindingActor.worker(
        worker_id=worker.id,
        owner_user_id=user.id,
        runtime_kind="cloud_sandbox",
        cloud_sandbox_id=uuid.uuid4(),
        generation=worker.generation,
    )
    with pytest.raises(CloudApiError) as caught:
        await issue_materialization_offer(
            db_session, stale, run_id=run.id, executor_id=str(worker.id), claim_id=None
        )
    assert caught.value.code == "workflow_cloud_executor_forbidden"
    count = await db_session.scalar(select(func.count()).select_from(WorkflowMaterializationOffer))
    assert count == 0


@pytest.mark.parametrize("field", ["repo", "ref"])
async def test_cloud_offer_rejects_plan_repo_or_ref_mismatch(
    db_session: AsyncSession, field: str
) -> None:
    user, run, sandbox, worker = await _cloud_identity_run(db_session)
    plan = dict(run.resolved_plan_json)
    source = dict(plan["sourceIntent"])
    source[field] = "github.com/evil/repo" if field == "repo" else "refs/heads/evil"
    plan["sourceIntent"] = source
    plan["planHash"] = compute_plan_hash(plan)
    run.resolved_plan_json = plan
    run.plan_hash = plan["planHash"]
    await db_session.flush()
    actor = BindingActor.worker(
        worker_id=worker.id,
        owner_user_id=user.id,
        runtime_kind="cloud_sandbox",
        cloud_sandbox_id=sandbox.id,
        generation=worker.generation,
    )
    with pytest.raises(CloudApiError) as caught:
        await issue_materialization_offer(
            db_session, actor, run_id=run.id, executor_id=str(worker.id), claim_id=None
        )
    assert caught.value.code == "workflow_source_provenance_invalid"


async def test_cloud_offer_requires_selected_branch_not_base_or_default(
    db_session: AsyncSession,
) -> None:
    user, run, sandbox, worker = await _cloud_identity_run(db_session)
    workspace = await db_session.scalar(
        select(CloudWorkspace).where(
            CloudWorkspace.anyharness_workspace_id == "sandbox-ws-1"
        )
    )
    assert workspace is not None
    workspace.git_branch = "feature/selected"
    await db_session.flush()
    actor = BindingActor.worker(
        worker_id=worker.id,
        owner_user_id=user.id,
        runtime_kind="cloud_sandbox",
        cloud_sandbox_id=sandbox.id,
        generation=worker.generation,
    )
    with pytest.raises(CloudApiError) as caught:
        await issue_materialization_offer(
            db_session,
            actor,
            run_id=run.id,
            executor_id=str(worker.id),
            claim_id=None,
        )
    assert caught.value.code == "workflow_source_provenance_invalid"


async def test_cloud_binding_requires_exact_resolved_commit(db_session: AsyncSession) -> None:
    user, run, sandbox, worker = await _cloud_identity_run(db_session)
    actor = BindingActor.worker(
        worker_id=worker.id,
        owner_user_id=user.id,
        runtime_kind="cloud_sandbox",
        cloud_sandbox_id=sandbox.id,
        generation=worker.generation,
    )
    offer = await issue_materialization_offer(
        db_session, actor, run_id=run.id, executor_id=str(worker.id), claim_id=None
    )
    raw = _cloud_binding(executor_id=str(worker.id))
    raw["baseCommitOid"] = "5" * 40
    raw["bindingHash"] = binding_hash(raw)
    with pytest.raises(CloudApiError) as caught:
        await accept_execution_binding(
            db_session,
            actor,
            run_id=run.id,
            request=_request(offer, raw),
            materialization_credential=offer.materialization_credential,
        )
    assert caught.value.code == "workflow_binding_source_conflict"


async def test_exact_committed_ack_survives_cancel_and_local_reclaim(
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
    request = _request(offer, _binding(executor_id="desktop-1"))
    first = await accept_execution_binding(
        db_session,
        actor,
        run_id=run.id,
        request=request,
        materialization_credential=offer.materialization_credential,
    )
    await db_session.commit()
    stored = await db_session.get(WorkflowRun, run.id)
    assert stored is not None
    stored.status = "cancelled"
    stored.desired_state = "cancel_requested"
    stored.preaccept_cancel_state = "cancelled_before_acceptance"
    stored.claim_id = uuid.uuid4()
    stored.executor_id = "desktop-reclaimed"
    await db_session.commit()
    retry = await accept_execution_binding(
        db_session,
        actor,
        run_id=run.id,
        request=request,
        materialization_credential=offer.materialization_credential,
    )
    assert first.accepted and retry.accepted and retry.idempotent
    assert retry.binding_hash == first.binding_hash


async def test_workspace_generation_update_waits_for_binding_acceptance_lock(
    db_session: AsyncSession,
    test_engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user, run, sandbox, worker = await _cloud_identity_run(db_session)
    actor = BindingActor.worker(
        worker_id=worker.id,
        owner_user_id=user.id,
        runtime_kind="cloud_sandbox",
        cloud_sandbox_id=sandbox.id,
        generation=worker.generation,
    )
    offer = await issue_materialization_offer(
        db_session, actor, run_id=run.id, executor_id=str(worker.id), claim_id=None
    )
    request = _request(offer, _cloud_binding(executor_id=str(worker.id)))
    await db_session.commit()
    authority_locked = asyncio.Event()
    release_accept = asyncio.Event()
    original = binding_service._cloud_offer_authority

    async def paused_authority(*args: object, **kwargs: object):  # type: ignore[no-untyped-def]
        authority = await original(*args, **kwargs)
        authority_locked.set()
        await release_accept.wait()
        return authority

    monkeypatch.setattr(binding_service, "_cloud_offer_authority", paused_authority)
    factory = async_sessionmaker(test_engine, expire_on_commit=False)

    async def accept() -> None:
        async with factory() as session:
            await accept_execution_binding(
                session,
                actor,
                run_id=run.id,
                request=request,
                materialization_credential=offer.materialization_credential,
            )
            await session.commit()

    async def rematerialize() -> None:
        await authority_locked.wait()
        async with factory() as session:
            current = await cloud_workspace_store.get_cloud_workspace_by_runtime_id(
                session,
                user_id=user.id,
                anyharness_workspace_id="sandbox-ws-1",
            )
            assert current is not None
            updated = await cloud_workspace_store.update_workspace_anyharness_workspace_id(
                session, current, "sandbox-ws-2"
            )
            assert updated is not None
            await session.commit()

    accept_task = asyncio.create_task(accept())
    update_task = asyncio.create_task(rematerialize())
    await authority_locked.wait()
    with pytest.raises(TimeoutError):
        await asyncio.wait_for(asyncio.shield(update_task), timeout=0.05)
    release_accept.set()
    await asyncio.gather(accept_task, update_task)


async def test_local_startrun_claim_parks_before_offer_without_checkpoint_attestation(
    db_session: AsyncSession,
) -> None:
    user = await make_user(db_session)
    definition, _ = parse_definition(
        {
            "version": 1,
            "inputs": [],
            "integrations": [],
            "agents": [
                {
                    "slot": "main",
                    "harness": "claude",
                    "model": "sonnet",
                    "steps": [{"kind": "agent.prompt", "prompt": "hi"}],
                }
            ],
        },
        require_steps=False,
    )
    workflow, _ = await workflow_store.create_workflow_with_version(
        db_session,
        owner_user_id=user.id,
        created_by_user_id=user.id,
        name="wf-id-e2e",
        description=None,
        definition_json=definition,
    )
    workspace_id = uuid.uuid4()
    started = await compiler.start_run(
        db_session,
        user,
        workflow.id,
        inputs={},
        target_mode="local",
        target_workspace_id=workspace_id,
    )
    claimed = await local_executor.claim_local_workflow_runs(
        db_session,
        user.id,
        LocalWorkflowClaimRequest(
            executorId="desktop-e2e",
            workspaceId=str(workspace_id),
            workspaceGeneration=1,
        ),  # type: ignore[call-arg]
    )
    assert started.status == "claimable" and len(claimed.runs) == 1
    run = await db_session.get(WorkflowRun, started.id)
    assert run is not None and run.claim_id is not None
    actor = await _local_actor(db_session, user.id, executor_id="desktop-e2e")
    with pytest.raises(CloudApiError) as caught:
        await issue_materialization_offer(
            db_session,
            actor,
            run_id=run.id,
            executor_id="desktop-e2e",
            claim_id=run.claim_id,
        )
    assert caught.value.code == "workflow_checkpoint_attestation_unavailable"
    offer_count = await db_session.scalar(
        select(func.count()).select_from(WorkflowMaterializationOffer)
    )
    assert offer_count == 0
    await db_session.refresh(run)
    assert run.binding_hash is None
