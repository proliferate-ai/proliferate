"""Adversarial tests for the WF-ID materialization/binding boundary."""

from __future__ import annotations

import asyncio
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.db.models.cloud.runtime_workers import CloudRuntimeWorker
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.workflow_gateway_models import WorkflowRunGatewayToken
from proliferate.db.models.cloud.workflow_identity import WorkflowMaterializationOffer
from proliferate.db.models.cloud.workflows import WorkflowRun
from proliferate.db.store import cloud_workflows as workflow_store
from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.db.store import repositories as repository_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.binding.models import AcceptExecutionBindingRequest
from proliferate.server.cloud.workflows.binding.access import BindingActor
from proliferate.server.cloud.workflows.binding.service import (
    _parse_credential,
    accept_execution_binding,
    get_execution_binding_status,
    issue_materialization_offer,
)
from proliferate.server.cloud.workflows.contracts.models import (
    binding_hash,
    plan_hash as compute_plan_hash,
)
from proliferate.server.cloud.workflows.models import run_payload
from tests.unit.workflow_ledger_helpers import make_run, make_user
from proliferate.utils.time import utcnow

pytestmark = pytest.mark.asyncio


async def _identity_run(db: AsyncSession):  # type: ignore[no-untyped-def]
    user = await make_user(db)
    run = await make_run(db, user)
    plan: dict[str, object] = {
        "planVersion": 1,
        "planHash": "",
        "run_id": str(run.id),
        "workflow_id": str(run.workflow_id),
        "workflow_version_id": str(run.workflow_version_id),
        "version_n": 1,
        "trigger_kind": run.trigger_kind,
        "target_mode": "local",
        "sourceIntent": {"kind": "local_commit", "resolvedCommit": "1" * 40},
        "sessions": {},
        "inputs": {},
        "isolation": "workspace",
        "steps": [],
    }
    plan["planHash"] = compute_plan_hash(plan)
    run.resolved_plan_json = plan
    run.plan_hash = plan["planHash"]
    run.plan_version = 1
    run.desired_state = "running"
    run.preaccept_cancel_state = "none"
    run.delivery_state = "ready"
    run.status = "claimed"
    run.anyharness_workspace_id = "desktop-ws-1"
    run.executor_id = "desktop-1"
    run.claim_id = uuid.uuid4()
    run.claim_generation = 1
    run.claimed_workspace_id = "desktop-ws-1"
    run.claimed_workspace_generation = 1
    run.claim_expires_at = utcnow() + timedelta(minutes=5)
    await db.flush()
    return user, run


async def _local_actor(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    executor_id: str = "desktop-1",
) -> BindingActor:
    worker = await db.scalar(
        select(CloudRuntimeWorker)
        .where(
            CloudRuntimeWorker.owner_user_id == user_id,
            CloudRuntimeWorker.runtime_kind == "desktop",
            CloudRuntimeWorker.desktop_install_id == executor_id,
            CloudRuntimeWorker.status != "revoked",
        )
        .order_by(CloudRuntimeWorker.generation.desc())
        .limit(1)
    )
    if worker is None:
        worker = CloudRuntimeWorker(
            owner_user_id=user_id,
            runtime_kind="desktop",
            desktop_install_id=executor_id,
            token_hash=uuid.uuid4().hex,
            status="online",
            generation=1,
            last_seen_at=utcnow(),
        )
        db.add(worker)
        await db.flush()
    return BindingActor.worker(
        worker_id=worker.id,
        owner_user_id=user_id,
        runtime_kind="desktop",
        desktop_install_id=executor_id,
        generation=worker.generation,
    )


async def _cloud_identity_run(db: AsyncSession):  # type: ignore[no-untyped-def]
    user, run = await _identity_run(db)
    repo = await repository_store.upsert_cloud_repo_environment(
        db,
        user_id=user.id,
        git_provider="github",
        git_owner="acme",
        git_repo_name="widgets",
        default_branch="main",
        setup_script="",
        run_command="",
    )
    workspace = await cloud_workspace_store.create_cloud_workspace(
        db,
        user_id=user.id,
        repo_environment_id=repo.id,
        display_name="widgets",
        git_branch="main",
        git_base_branch="main",
        anyharness_workspace_id="sandbox-ws-1",
    )
    assert workspace is not None
    sandbox = CloudSandbox(
        owner_user_id=user.id,
        sandbox_type="e2b",
        status="ready",
        purpose="workflow-run",
    )
    db.add(sandbox)
    await db.flush()
    worker = CloudRuntimeWorker(
        owner_user_id=user.id,
        runtime_kind="cloud_sandbox",
        cloud_sandbox_id=sandbox.id,
        token_hash=uuid.uuid4().hex,
        status="online",
        generation=1,
    )
    db.add(worker)
    await db.flush()
    plan = dict(run.resolved_plan_json)
    plan["target_mode"] = "personal_cloud"
    plan["sourceIntent"] = {
        "kind": "remote_commit",
        "repo": "github.com/acme/widgets",
        "ref": "refs/heads/main",
        "resolvedCommit": "4" * 40,
    }
    plan["planHash"] = compute_plan_hash(plan)
    run.resolved_plan_json = plan
    run.plan_hash = plan["planHash"]
    run.target_mode = "personal_cloud"
    run.status = "pending_delivery"
    run.anyharness_workspace_id = "sandbox-ws-1"
    run.executor_id = None
    run.claim_id = None
    run.claim_generation = None
    run.claimed_workspace_id = None
    run.claimed_workspace_generation = None
    run.claim_expires_at = None
    await db.flush()
    return user, run, sandbox, worker


def _binding(
    *,
    executor_id: str,
    workspace_id: str = "desktop-ws-1",
    materialization_id: str = "materialization-1",
) -> dict[str, object]:
    raw: dict[str, object] = {
        "schemaVersion": 1,
        "target": "local",
        "sourceKind": "local_commit",
        "repositoryObjectFormat": "sha1",
        "baseCommitOid": "1" * 40,
        "workspaceId": workspace_id,
        "workspaceGeneration": 1,
        "materializationId": materialization_id,
        "executorId": executor_id,
        "executorGeneration": 1,
        "bindingHash": "",
    }
    raw["bindingHash"] = binding_hash(raw)
    return raw


def _cloud_binding(*, executor_id: str) -> dict[str, object]:
    raw: dict[str, object] = {
        "schemaVersion": 1,
        "target": "personal_cloud",
        "sourceKind": "remote_commit",
        "repositoryObjectFormat": "sha1",
        "baseCommitOid": "4" * 40,
        "workspaceId": "sandbox-ws-1",
        "workspaceGeneration": 1,
        "materializationId": "cloud-materialization-1",
        "executorId": executor_id,
        "executorGeneration": 1,
        "bindingHash": "",
    }
    raw["bindingHash"] = binding_hash(raw)
    return raw


def _request(offer, binding: dict[str, object]) -> AcceptExecutionBindingRequest:  # type: ignore[no-untyped-def]
    return AcceptExecutionBindingRequest.model_validate(
        {
            "schemaVersion": 1,
            "executionGeneration": offer.execution_generation,
            "executorFence": offer.executor_fence,
            "binding": binding,
        }
    )


async def test_offer_stores_only_salted_materialization_credential(
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

    stored = await db_session.scalar(
        select(WorkflowMaterializationOffer).where(
            WorkflowMaterializationOffer.workflow_run_id == run.id
        )
    )
    assert stored is not None
    assert stored.audience == "workflow_materialization"
    assert len(stored.credential_salt) == 64
    assert len(stored.credential_hash) == 64
    assert offer.materialization_credential not in stored.credential_hash
    assert offer.materialization_credential not in stored.credential_salt
    assert offer.materialization_credential not in repr(stored)
    assert offer.materialization_credential not in repr(stored.__dict__)
    await db_session.refresh(run)
    assert run.private_envelope_json is None
    stored_record = await workflow_store.get_run(db_session, run.id)
    assert stored_record is not None
    assert offer.materialization_credential not in run_payload(stored_record).model_dump_json()
    token_count = await db_session.scalar(
        select(func.count()).select_from(WorkflowRunGatewayToken)
    )
    assert token_count == 0


@pytest.mark.parametrize(
    "raw",
    [
        "wfm1.11111111-1111-4111-8111-111111111111.short",
        "wfm1.11111111-1111-4111-8111-111111111111." + "A" * 44,
        "wfm1.11111111-1111-4111-8111-111111111111." + "A" * 42 + "=",
        "wfm1.11111111-1111-4111-8111-111111111111." + "A" * 42 + ".",
        "wfm1.11111111-1111-1111-8111-111111111111." + "A" * 43,
        "wfm1.11111111-1111-4111-8111-111111111111." + "A" * 10_000,
    ],
)
async def test_materialization_credential_parser_is_exact_and_bounded(raw: str) -> None:
    with pytest.raises(CloudApiError) as caught:
        _parse_credential(raw)
    assert caught.value.code == "workflow_materialization_credential_invalid"

    offer_id, secret = _parse_credential(
        "wfm1.11111111-1111-4111-8111-111111111111." + "A" * 43
    )
    assert str(offer_id) == "11111111-1111-4111-8111-111111111111"
    assert secret == "A" * 43


async def test_reissued_offer_rotates_credential_and_invalidates_late_response(
    db_session: AsyncSession,
) -> None:
    """A slower first HTTP response cannot revive its credential after reissue.

    Both responses identify the same execution offer, so clients monotonically
    retain the highest ``credentialGeneration``. The server independently makes
    that rule fail closed by replacing the salted digest before returning the
    second response.
    """

    user, run = await _identity_run(db_session)
    actor = await _local_actor(db_session, user.id)
    first = await issue_materialization_offer(
        db_session,
        actor,
        run_id=run.id,
        executor_id="desktop-1",
        claim_id=run.claim_id,
    )
    second = await issue_materialization_offer(
        db_session,
        actor,
        run_id=run.id,
        executor_id="desktop-1",
        claim_id=run.claim_id,
    )

    assert second.execution_generation == first.execution_generation
    assert second.credential_generation == first.credential_generation + 1
    assert second.materialization_credential != first.materialization_credential
    assert second.materialization_credential.split(".", 2)[1] == (
        first.materialization_credential.split(".", 2)[1]
    )

    with pytest.raises(CloudApiError) as stale:
        await accept_execution_binding(
            db_session,
            actor,
            run_id=run.id,
            request=_request(first, _binding(executor_id="desktop-1")),
            materialization_credential=first.materialization_credential,
        )
    assert stale.value.code == "workflow_materialization_credential_invalid"

    accepted = await accept_execution_binding(
        db_session,
        actor,
        run_id=run.id,
        request=_request(second, _binding(executor_id="desktop-1")),
        materialization_credential=second.materialization_credential,
    )
    assert accepted.accepted and not accepted.idempotent


async def test_committed_binding_status_survives_credential_and_claim_expiry(
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
    accepted = await accept_execution_binding(
        db_session,
        actor,
        run_id=run.id,
        request=_request(offer, _binding(executor_id="desktop-1")),
        materialization_credential=offer.materialization_credential,
    )
    stored_offer = await db_session.scalar(
        select(WorkflowMaterializationOffer).where(
            WorkflowMaterializationOffer.workflow_run_id == run.id
        )
    )
    assert stored_offer is not None and stored_offer.status == "consumed"
    stored_offer.expires_at = utcnow() - timedelta(days=1)
    run.claim_expires_at = utcnow() - timedelta(days=1)
    run.status = "completed"
    await db_session.flush()

    recovered = await get_execution_binding_status(db_session, actor, run_id=run.id)
    assert recovered.accepted
    assert recovered.binding_hash == accepted.binding_hash
    assert recovered.execution_generation == accepted.execution_generation
    rendered = recovered.model_dump_json(by_alias=True)
    assert "materializationCredential" not in rendered
    assert "executorFence" not in rendered
    assert offer.materialization_credential not in rendered

    wrong = await _local_actor(db_session, user.id, executor_id="desktop-2")
    with pytest.raises(CloudApiError) as forbidden:
        await get_execution_binding_status(db_session, wrong, run_id=run.id)
    assert forbidden.value.code == "workflow_local_executor_forbidden"


async def test_workspace_checkpoint_offer_requires_trusted_attestation(
    db_session: AsyncSession,
) -> None:
    user, run = await _identity_run(db_session)
    actor = await _local_actor(db_session, user.id)
    plan = dict(run.resolved_plan_json)
    plan["sourceIntent"] = {"kind": "workspace_checkpoint"}
    plan["planHash"] = compute_plan_hash(plan)
    run.resolved_plan_json = plan
    run.plan_hash = plan["planHash"]
    await db_session.flush()
    with pytest.raises(CloudApiError) as caught:
        await issue_materialization_offer(
            db_session,
            actor,
            run_id=run.id,
            executor_id="desktop-1",
            claim_id=run.claim_id,
        )
    assert caught.value.code == "workflow_checkpoint_attestation_unavailable"
    offer_count = await db_session.scalar(
        select(func.count()).select_from(WorkflowMaterializationOffer)
    )
    assert offer_count == 0
    await db_session.refresh(run)
    assert run.binding_hash is None


async def test_only_selected_enrolled_desktop_worker_can_offer_or_accept(
    db_session: AsyncSession,
) -> None:
    user, run = await _identity_run(db_session)
    selected = await _local_actor(db_session, user.id)
    wrong = await _local_actor(db_session, user.id, executor_id="desktop-2")

    with pytest.raises(CloudApiError) as offer_error:
        await issue_materialization_offer(
            db_session,
            wrong,
            run_id=run.id,
            executor_id="desktop-1",
            claim_id=run.claim_id,
        )
    assert offer_error.value.code == "workflow_local_executor_forbidden"

    offer = await issue_materialization_offer(
        db_session,
        selected,
        run_id=run.id,
        executor_id="desktop-1",
        claim_id=run.claim_id,
    )
    with pytest.raises(CloudApiError) as accept_error:
        await accept_execution_binding(
            db_session,
            wrong,
            run_id=run.id,
            request=_request(offer, _binding(executor_id="desktop-1")),
            materialization_credential=offer.materialization_credential,
        )
    assert accept_error.value.code == "workflow_local_executor_forbidden"
    await db_session.refresh(run)
    assert run.binding_hash is None


async def test_tampered_binding_content_with_same_hash_is_rejected_without_mutation(
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
    tampered = _binding(executor_id="desktop-1")
    original_hash = tampered["bindingHash"]
    tampered["baseCommitOid"] = "3" * 40
    assert tampered["bindingHash"] == original_hash

    with pytest.raises(CloudApiError) as caught:
        await accept_execution_binding(
            db_session,
            actor,
            run_id=run.id,
            request=_request(offer, tampered),
            materialization_credential=offer.materialization_credential,
        )
    assert caught.value.code == "workflow_binding_hash_mismatch"
    await db_session.refresh(run)
    assert run.binding_hash is None
    assert run.execution_generation is None
    assert run.execution_binding_json is None
    stored_offer = await db_session.scalar(
        select(WorkflowMaterializationOffer).where(
            WorkflowMaterializationOffer.workflow_run_id == run.id
        )
    )
    assert stored_offer is not None and stored_offer.status == "pending"


async def test_binding_acceptance_is_idempotent_and_mints_no_final_credential(
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
    request = _request(offer, raw)

    accepted = await accept_execution_binding(
        db_session,
        actor,
        run_id=run.id,
        request=request,
        materialization_credential=offer.materialization_credential,
    )
    retried = await accept_execution_binding(
        db_session,
        actor,
        run_id=run.id,
        request=request,
        materialization_credential=offer.materialization_credential,
    )
    assert accepted.accepted and not accepted.idempotent
    assert retried.accepted and retried.idempotent
    await db_session.refresh(run)
    assert run.binding_hash == raw["bindingHash"]
    assert run.execution_generation == 1
    assert run.execution_binding_json == raw
    assert run.delivery_state == "materializing"
    assert run.private_envelope_json is None
    token_count = await db_session.scalar(
        select(func.count()).select_from(WorkflowRunGatewayToken)
    )
    assert token_count == 0


async def test_concurrent_different_bindings_accept_exactly_one(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
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
    run_id = run.id
    await db_session.commit()

    first = _binding(executor_id="desktop-1", materialization_id="desktop-mat-a")
    second = _binding(executor_id="desktop-1", materialization_id="desktop-mat-b")
    factory = async_sessionmaker(test_engine, expire_on_commit=False)

    async def _accept(raw: dict[str, object]) -> str:
        async with factory() as session:
            try:
                await accept_execution_binding(
                    session,
                    actor,
                    run_id=run_id,
                    request=_request(offer, raw),
                    materialization_credential=offer.materialization_credential,
                )
                await session.commit()
                return "accepted"
            except CloudApiError as exc:
                await session.rollback()
                return exc.code

    outcomes = await asyncio.gather(_accept(first), _accept(second))
    assert outcomes.count("accepted") == 1
    assert outcomes.count("workflow_binding_identity_conflict") == 1
    async with factory() as verify:
        stored = await verify.get(WorkflowRun, run_id)
        assert stored is not None
        assert stored.execution_binding_json in (first, second)


async def test_owner_cannot_fetch_or_submit_cloud_binding(
    db_session: AsyncSession,
) -> None:
    user, run, sandbox, worker = await _cloud_identity_run(db_session)
    selected_id = worker.id
    owner_desktop_actor = await _local_actor(db_session, user.id)

    with pytest.raises(CloudApiError) as fetch_error:
        await issue_materialization_offer(
            db_session,
            owner_desktop_actor,
            run_id=run.id,
            executor_id=str(selected_id),
            claim_id=None,
        )
    assert fetch_error.value.code == "workflow_cloud_executor_forbidden"
    offer_count = await db_session.scalar(
        select(func.count()).select_from(WorkflowMaterializationOffer)
    )
    assert offer_count == 0

    selected = BindingActor.worker(
        worker_id=selected_id,
        owner_user_id=user.id,
        runtime_kind="cloud_sandbox",
        cloud_sandbox_id=sandbox.id,
        generation=worker.generation,
    )
    offer = await issue_materialization_offer(
        db_session,
        selected,
        run_id=run.id,
        executor_id=str(selected_id),
        claim_id=None,
    )
    with pytest.raises(CloudApiError) as submit_error:
        await accept_execution_binding(
            db_session,
            owner_desktop_actor,
            run_id=run.id,
            request=_request(offer, _cloud_binding(executor_id=str(selected_id))),
            materialization_credential=offer.materialization_credential,
        )
    assert submit_error.value.code == "workflow_cloud_executor_forbidden"
    await db_session.refresh(run)
    assert run.binding_hash is None
    stored_record = await workflow_store.get_run(db_session, run.id)
    assert stored_record is not None
    assert offer.materialization_credential not in run_payload(stored_record).model_dump_json()


async def test_wrong_worker_cannot_fetch_or_submit_cloud_binding(
    db_session: AsyncSession,
) -> None:
    user, run, sandbox, worker = await _cloud_identity_run(db_session)
    selected_id = worker.id
    wrong_id = uuid.uuid4()
    wrong = BindingActor.worker(
        worker_id=wrong_id,
        owner_user_id=user.id,
        runtime_kind="cloud_sandbox",
        cloud_sandbox_id=sandbox.id,
        generation=1,
    )
    with pytest.raises(CloudApiError) as fetch_error:
        await issue_materialization_offer(
            db_session,
            wrong,
            run_id=run.id,
            executor_id=str(selected_id),
            claim_id=None,
        )
    assert fetch_error.value.code == "workflow_cloud_executor_forbidden"

    selected = BindingActor.worker(
        worker_id=selected_id,
        owner_user_id=user.id,
        runtime_kind="cloud_sandbox",
        cloud_sandbox_id=sandbox.id,
        generation=worker.generation,
    )
    offer = await issue_materialization_offer(
        db_session,
        selected,
        run_id=run.id,
        executor_id=str(selected_id),
        claim_id=None,
    )
    with pytest.raises(CloudApiError) as submit_error:
        await accept_execution_binding(
            db_session,
            wrong,
            run_id=run.id,
            request=_request(offer, _cloud_binding(executor_id=str(selected_id))),
            materialization_credential=offer.materialization_credential,
        )
    assert submit_error.value.code == "workflow_cloud_executor_forbidden"


async def test_archive_restore_rotates_workspace_and_invalidates_cloud_offer(
    db_session: AsyncSession,
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
        db_session,
        actor,
        run_id=run.id,
        executor_id=str(worker.id),
        claim_id=None,
    )
    workspace = await cloud_workspace_store.get_cloud_workspace_by_runtime_id(
        db_session,
        user_id=user.id,
        anyharness_workspace_id="sandbox-ws-1",
    )
    assert workspace is not None and workspace.generation == 1
    archived = await cloud_workspace_store.archive_cloud_workspace(db_session, workspace)
    restored = await cloud_workspace_store.restore_cloud_workspace(db_session, archived)
    assert restored is not None and restored.generation == 3
    replacement = await issue_materialization_offer(
        db_session,
        actor,
        run_id=run.id,
        executor_id=str(worker.id),
        claim_id=None,
    )
    assert offer.execution_generation == 1
    assert replacement.execution_generation == 2

    with pytest.raises(CloudApiError) as caught:
        await accept_execution_binding(
            db_session,
            actor,
            run_id=run.id,
            request=_request(offer, _cloud_binding(executor_id=str(worker.id))),
            materialization_credential=offer.materialization_credential,
        )
    assert caught.value.code == "workflow_materialization_credential_invalid"
    await db_session.refresh(run)
    assert run.binding_hash is None


async def test_display_name_only_does_not_rotate_workspace_generation(
    db_session: AsyncSession,
) -> None:
    user, _run, _sandbox, _worker = await _cloud_identity_run(db_session)
    workspace = await cloud_workspace_store.get_cloud_workspace_by_runtime_id(
        db_session,
        user_id=user.id,
        anyharness_workspace_id="sandbox-ws-1",
    )
    assert workspace is not None
    renamed = await cloud_workspace_store.update_workspace_display_name(
        db_session, workspace, "renamed"
    )
    assert renamed.generation == workspace.generation


async def test_expired_local_claim_cannot_issue_offer(
    db_session: AsyncSession,
) -> None:
    user, run = await _identity_run(db_session)
    actor = await _local_actor(db_session, user.id)
    run.claim_expires_at = utcnow() - timedelta(seconds=1)
    await db_session.flush()

    with pytest.raises(CloudApiError) as caught:
        await issue_materialization_offer(
            db_session,
            actor,
            run_id=run.id,
            executor_id="desktop-1",
            claim_id=run.claim_id,
        )
    assert caught.value.code == "workflow_local_claim_conflict"
    offer_count = await db_session.scalar(
        select(func.count()).select_from(WorkflowMaterializationOffer)
    )
    assert offer_count == 0


async def test_reclaim_rotates_fence_and_revokes_old_offer_without_binding(
    db_session: AsyncSession,
) -> None:
    user, run = await _identity_run(db_session)
    actor = await _local_actor(db_session, user.id)
    old_offer = await issue_materialization_offer(
        db_session,
        actor,
        run_id=run.id,
        executor_id="desktop-1",
        claim_id=run.claim_id,
    )
    old_claim_id = run.claim_id
    run.claim_expires_at = utcnow() - timedelta(seconds=1)
    await db_session.flush()
    claimed = await workflow_store.claim_local_workflow_runs(
        db_session,
        user_id=user.id,
        executor_id="desktop-2",
        workspace_id="desktop-ws-1",
        workspace_generation=2,
        claim_ttl=timedelta(minutes=5),
        limit=1,
        now=utcnow(),
    )
    assert len(claimed) == 1
    assert claimed[0].claim_id != old_claim_id
    replacement_actor = await _local_actor(
        db_session, user.id, executor_id="desktop-2"
    )
    replacement = await issue_materialization_offer(
        db_session,
        replacement_actor,
        run_id=run.id,
        executor_id="desktop-2",
        claim_id=claimed[0].claim_id,
    )
    assert old_offer.execution_generation == 1
    assert replacement.execution_generation == 2

    with pytest.raises(CloudApiError) as caught:
        await accept_execution_binding(
            db_session,
            actor,
            run_id=run.id,
            request=_request(old_offer, _binding(executor_id="desktop-1")),
            materialization_credential=old_offer.materialization_credential,
        )
    assert caught.value.code == "workflow_materialization_credential_invalid"
    await db_session.refresh(run)
    assert run.binding_hash is None
    # The offer id is encoded in the credential, not the claim fence.
    offer_id = uuid.UUID(old_offer.materialization_credential.split(".", 2)[1])
    stored_offer = await db_session.get(WorkflowMaterializationOffer, offer_id)
    assert stored_offer is not None and stored_offer.status == "revoked"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("status", "cancelled"),
        ("desired_state", "cancel_requested"),
        ("preaccept_cancel_state", "cancelling_preaccept"),
    ],
)
async def test_cancel_or_terminal_state_rejects_acceptance_without_mutation(
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
    setattr(run, field, value)
    await db_session.flush()
    with pytest.raises(CloudApiError) as caught:
        await accept_execution_binding(
            db_session,
            actor,
            run_id=run.id,
            request=_request(offer, _binding(executor_id="desktop-1")),
            materialization_credential=offer.materialization_credential,
        )
    assert caught.value.code == "workflow_run_not_bindable"
    await db_session.refresh(run)
    assert run.binding_hash is None


async def test_binding_must_match_offer_workspace_and_executor_generations(
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
    raw["workspaceGeneration"] = 2
    raw["bindingHash"] = binding_hash(raw)
    with pytest.raises(CloudApiError) as caught:
        await accept_execution_binding(
            db_session,
            actor,
            run_id=run.id,
            request=_request(offer, raw),
            materialization_credential=offer.materialization_credential,
        )
    assert caught.value.code == "workflow_binding_generation_conflict"
