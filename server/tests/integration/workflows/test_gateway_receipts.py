"""T1-WF-GATEWAY-01: WS3b+WS3c gateway receipts on real Postgres.

Exercises the full §7.3 required-invocation flow against the real database
(the ``db_session`` fixture is a Postgres session): WS3b credential-exchange
lost-response-retry idempotency, WS3c activation registration, the trusted
gateway call path (authorize -> execute -> durably record BEFORE returning),
wrong-context denial, exactly-once upstream dispatch under a recovered lost
response, and the no-secret-in-any-surface guarantee.

Run (from ``server/``):
``DEBUG=true uv run --extra dev pytest -q tests/integration/workflows/test_gateway_receipts.py``
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import FUNCTION_INVOCATION_PROVIDER_NAMESPACE
from proliferate.db.models.auth import User
from proliferate.db.store import function_invocations as invocations_store
from proliferate.db.store import runtime_workers as runtime_workers_store
from proliferate.db.store import workflow_credentials as credentials_store
from proliferate.db.store import workflow_ledger as ledger
from proliferate.db.store.runtime_workers import IntegrationGatewayGrant
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integration_gateway import service as gateway_service
from proliferate.server.cloud.workflows import activation_receipts
from proliferate.server.cloud.workflows.activation_registration import register_activation
from proliferate.server.cloud.workflows.credential_exchange import exchange_slot_credential
from proliferate.server.cloud.workflows.domain import gate
from proliferate.server.cloud.workflows.domain.capabilities import FunctionRef
from proliferate.utils.time import utcnow

pytestmark = pytest.mark.asyncio

_PLAN_HASH = "sha256:" + "a" * 64
_SLOT = "main"
_SESSION = "sess-1"
_STEP_KEY = "root::main::-::step-1"


async def _make_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"gw-receipt-{uuid.uuid4().hex}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


async def _make_run(db: AsyncSession, user: User):
    from proliferate.db.models.cloud.workflows import Workflow, WorkflowVersion

    now = utcnow()
    workflow = Workflow(
        id=uuid.uuid4(),
        owner_user_id=user.id,
        created_by_user_id=user.id,
        name="gw-receipts-wf",
        created_at=now,
        updated_at=now,
    )
    db.add(workflow)
    await db.flush()
    version = WorkflowVersion(
        id=uuid.uuid4(),
        workflow_id=workflow.id,
        version_n=1,
        definition_json={"version": 1},
        created_by_user_id=user.id,
        created_at=now,
    )
    db.add(version)
    await db.flush()
    from proliferate.db.store import cloud_workflows as store

    return await store.create_run(
        db,
        workflow_id=workflow.id,
        workflow_version_id=version.id,
        trigger_kind="manual",
        executor_user_id=user.id,
        args_json={},
        target_mode="personal_cloud",
        resolved_plan_json={"run_id": "x", "steps": []},
        status="delivered",
        plan_hash=_PLAN_HASH,
    )


async def _make_function_capability(db: AsyncSession, *, user: User, run_id: uuid.UUID) -> str:
    """Create a function invocation, freeze it as a per-slot lease, and return
    its ``capability_key``."""

    invocation = await invocations_store.create(
        db,
        owner_user_id=user.id,
        organization_id=None,
        created_by_user_id=user.id,
        name="notify",
        endpoint_url="https://example.invalid/notify",
        method="post",
        args_schema_json={},
    )
    capability_key = FunctionRef(
        definition_id=str(invocation.id), semantic_revision=invocation.semantic_revision
    ).capability_key
    await ledger.insert_capability_lease(
        db,
        run_id=run_id,
        slot_id=_SLOT,
        kind="function",
        capability_key=capability_key,
        plan_hash=_PLAN_HASH,
        function_definition_id=str(invocation.id),
        semantic_revision=invocation.semantic_revision,
    )
    return capability_key


def _grant(*, user: User, run_id: uuid.UUID, slot_id: str = _SLOT, session_id: str = _SESSION):
    return IntegrationGatewayGrant(
        owner_user_id=user.id,
        organization_id=None,
        run_id=run_id,
        run_scope=[{"provider": FUNCTION_INVOCATION_PROVIDER_NAMESPACE}],
        worker_scope=None,
        slot_id=slot_id,
        session_id=session_id,
    )


@dataclass
class _CallCounter:
    count: int = 0
    last_arguments: dict[str, object] | None = None


def _patch_function_dispatch(
    monkeypatch: pytest.MonkeyPatch, *, secret_marker: str = "sekret-value"
) -> _CallCounter:
    counter = _CallCounter()

    async def _fake_call_invocation(db, *, owner_user_id, name, arguments):
        del db, owner_user_id, name
        counter.count += 1
        counter.last_arguments = arguments
        return {
            "content": [{"type": "text", "text": "ok"}],
            "structuredContent": {"ok": True},
            "isError": False,
        }

    monkeypatch.setattr(
        gateway_service.functions_dispatch, "call_invocation", _fake_call_invocation
    )
    return counter


# --- WS3b: credential-exchange lost-response retry (issuance idempotency) ------


async def test_credential_exchange_lost_response_retry_returns_one_generation(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    run = await _make_run(db_session, user)
    handle = f"handle-{uuid.uuid4().hex}"
    await credentials_store.create_issuance_handle(
        db_session,
        workflow_run_id=run.id,
        slot_id=_SLOT,
        handle_hash=runtime_workers_store.hash_workflow_issuance_handle(handle),
        plan_hash=_PLAN_HASH,
    )

    first = await exchange_slot_credential(
        db_session, run_id=run.id, owner_user_id=user.id, handle=handle, session_id=_SESSION
    )
    assert first.generation == 1

    # A lost-response retry (same handle, same unacknowledged session): the
    # SAME generation comes back, not a second one — the secret is re-minted
    # (a lost first response is invalidated) but the contract-visible identity
    # (generation) is unchanged.
    retried = await exchange_slot_credential(
        db_session, run_id=run.id, owner_user_id=user.id, handle=handle, session_id=_SESSION
    )
    assert retried.generation == 1
    assert retried.authorization != first.authorization


# --- WS3c: activation registration idempotency + typed conflict ----------------


async def test_register_activation_idempotent_and_conflict_typed(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    run = await _make_run(db_session, user)
    capability_key = await _make_function_capability(db_session, user=user, run_id=run.id)
    activation_id = f"act-{uuid.uuid4().hex}"

    first = await register_activation(
        db_session,
        run_id=run.id,
        plan_hash=_PLAN_HASH,
        slot_id=_SLOT,
        session_id=_SESSION,
        step_key=_STEP_KEY,
        attempt=1,
        activation_id=activation_id,
        capability_key=capability_key,
    )

    # Identical retry -> the SAME row (durable-before-response, idempotent).
    retried = await register_activation(
        db_session,
        run_id=run.id,
        plan_hash=_PLAN_HASH,
        slot_id=_SLOT,
        session_id=_SESSION,
        step_key=_STEP_KEY,
        attempt=1,
        activation_id=activation_id,
        capability_key=capability_key,
    )
    assert retried.id == first.id

    # Same activation_id, different identity -> typed 409 conflict.
    with pytest.raises(CloudApiError) as excinfo:
        await register_activation(
            db_session,
            run_id=run.id,
            plan_hash=_PLAN_HASH,
            slot_id=_SLOT,
            session_id=_SESSION,
            step_key=_STEP_KEY,
            attempt=2,  # a different attempt under the SAME activation id.
            activation_id=activation_id,
            capability_key=capability_key,
        )
    assert excinfo.value.code == "workflow_activation_conflict"
    assert excinfo.value.status_code == 409


# --- WS3c: trusted activation succeeds; receipt satisfies the gate -------------


async def test_trusted_activation_succeeds_and_satisfies_gate(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _make_user(db_session)
    run = await _make_run(db_session, user)
    capability_key = await _make_function_capability(db_session, user=user, run_id=run.id)
    activation_id = f"act-{uuid.uuid4().hex}"
    await register_activation(
        db_session,
        run_id=run.id,
        plan_hash=_PLAN_HASH,
        slot_id=_SLOT,
        session_id=_SESSION,
        step_key=_STEP_KEY,
        attempt=1,
        activation_id=activation_id,
        capability_key=capability_key,
    )
    counter = _patch_function_dispatch(monkeypatch)
    grant = _grant(user=user, run_id=run.id)

    result = await gateway_service.call_provider_tool(
        db_session,
        grant=grant,
        provider=FUNCTION_INVOCATION_PROVIDER_NAMESPACE,
        tool="notify",
        arguments={"message": "hello"},
        activation_id=activation_id,
    )
    assert result["isError"] is False
    assert counter.count == 1

    receipt = await ledger.get_gateway_receipt_by_activation(
        db_session, activation_id=activation_id
    )
    assert receipt is not None
    assert receipt.authorization_decision == "allow"
    assert receipt.outcome == "success"

    assert gate.gate_satisfied(
        [receipt],
        slot_id=_SLOT,
        step_key=_STEP_KEY,
        attempt=1,
        capability_key=capability_key,
    )

    # The runtime query surface recovers the SAME authoritative record.
    found = await activation_receipts.get_activation_and_receipt(
        db_session, run_id=run.id, activation_id=activation_id
    )
    assert found is not None
    _activation, queried_receipt = found
    assert queried_receipt is not None and queried_receipt.id == receipt.id


# --- WS3c: wrong activation context fails, no upstream call, no receipt -------


async def test_wrong_context_fails_without_upstream_call_or_receipt(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _make_user(db_session)
    run = await _make_run(db_session, user)
    capability_key = await _make_function_capability(db_session, user=user, run_id=run.id)
    activation_id = f"act-{uuid.uuid4().hex}"
    await register_activation(
        db_session,
        run_id=run.id,
        plan_hash=_PLAN_HASH,
        slot_id=_SLOT,
        session_id=_SESSION,
        step_key=_STEP_KEY,
        attempt=1,
        activation_id=activation_id,
        capability_key=capability_key,
    )
    counter = _patch_function_dispatch(monkeypatch)
    # A credential bound to a DIFFERENT session than the registered activation
    # (e.g. a stolen/mismatched activation id, or a takeover race).
    wrong_grant = _grant(user=user, run_id=run.id, session_id="sess-other")

    with pytest.raises(CloudApiError) as excinfo:
        await gateway_service.call_provider_tool(
            db_session,
            grant=wrong_grant,
            provider=FUNCTION_INVOCATION_PROVIDER_NAMESPACE,
            tool="notify",
            arguments={"message": "hello"},
            activation_id=activation_id,
        )
    assert excinfo.value.code == "integration_gateway_activation_context_mismatch"
    assert counter.count == 0

    # No receipt was fabricated for someone else's activation.
    receipt = await ledger.get_gateway_receipt_by_activation(
        db_session, activation_id=activation_id
    )
    assert receipt is None


# --- WS3c: capability mismatch denies AND consumes the activation --------------


async def test_capability_mismatch_denies_and_writes_denied_receipt(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _make_user(db_session)
    run = await _make_run(db_session, user)
    capability_key = await _make_function_capability(db_session, user=user, run_id=run.id)
    activation_id = f"act-{uuid.uuid4().hex}"
    await register_activation(
        db_session,
        run_id=run.id,
        plan_hash=_PLAN_HASH,
        slot_id=_SLOT,
        session_id=_SESSION,
        step_key=_STEP_KEY,
        attempt=1,
        activation_id=activation_id,
        capability_key=capability_key,
    )
    counter = _patch_function_dispatch(monkeypatch)
    grant = _grant(user=user, run_id=run.id)

    # The activation names "notify"; the call dispatches a DIFFERENT tool name.
    with pytest.raises(CloudApiError) as excinfo:
        await gateway_service.call_provider_tool(
            db_session,
            grant=grant,
            provider=FUNCTION_INVOCATION_PROVIDER_NAMESPACE,
            tool="some_other_function",
            arguments={},
            activation_id=activation_id,
        )
    assert excinfo.value.code == "integration_gateway_activation_capability_mismatch"
    assert counter.count == 0

    receipt = await ledger.get_gateway_receipt_by_activation(
        db_session, activation_id=activation_id
    )
    assert receipt is not None
    assert receipt.authorization_decision == "deny"
    assert receipt.outcome == "denied"
    # The activation is CONSUMED — a retry under the SAME activation id, even
    # with the correct tool this time, recovers the denial instead of trying
    # again (a corrective turn must mint a fresh activation id).
    result = await gateway_service.call_provider_tool(
        db_session,
        grant=grant,
        provider=FUNCTION_INVOCATION_PROVIDER_NAMESPACE,
        tool="notify",
        arguments={},
        activation_id=activation_id,
    )
    assert result["isError"] is True
    assert counter.count == 0


# --- WS3c: exactly one upstream call for a recovered lost response -------------


async def test_recovered_lost_response_makes_exactly_one_upstream_call(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _make_user(db_session)
    run = await _make_run(db_session, user)
    capability_key = await _make_function_capability(db_session, user=user, run_id=run.id)
    activation_id = f"act-{uuid.uuid4().hex}"
    await register_activation(
        db_session,
        run_id=run.id,
        plan_hash=_PLAN_HASH,
        slot_id=_SLOT,
        session_id=_SESSION,
        step_key=_STEP_KEY,
        attempt=1,
        activation_id=activation_id,
        capability_key=capability_key,
    )
    counter = _patch_function_dispatch(monkeypatch)
    grant = _grant(user=user, run_id=run.id)

    first_result = await gateway_service.call_provider_tool(
        db_session,
        grant=grant,
        provider=FUNCTION_INVOCATION_PROVIDER_NAMESPACE,
        tool="notify",
        arguments={"message": "hello"},
        activation_id=activation_id,
    )
    assert first_result["isError"] is False
    assert counter.count == 1

    # The runtime never saw the first response (network loss) and retries the
    # SAME activation id. The gateway recovers the durable record and does NOT
    # repeat the external effect (§7.3) — the upstream call count stays at 1.
    recovered_result = await gateway_service.call_provider_tool(
        db_session,
        grant=grant,
        provider=FUNCTION_INVOCATION_PROVIDER_NAMESPACE,
        tool="notify",
        arguments={"message": "hello"},
        activation_id=activation_id,
    )
    assert recovered_result["isError"] is False
    assert counter.count == 1

    receipts = await activation_receipts.list_receipts_for_gate(
        db_session, run_id=run.id, slot_id=_SLOT, step_key=_STEP_KEY, attempt=1
    )
    assert len(receipts) == 1


# --- no secret in any public/audit surface -------------------------------------


async def test_no_secret_in_public_or_audit_surfaces(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _make_user(db_session)
    run = await _make_run(db_session, user)
    capability_key = await _make_function_capability(db_session, user=user, run_id=run.id)
    activation_id = f"act-{uuid.uuid4().hex}"
    await register_activation(
        db_session,
        run_id=run.id,
        plan_hash=_PLAN_HASH,
        slot_id=_SLOT,
        session_id=_SESSION,
        step_key=_STEP_KEY,
        attempt=1,
        activation_id=activation_id,
        capability_key=capability_key,
    )
    secret_marker = "sekret-value-should-never-be-persisted"
    counter = _patch_function_dispatch(monkeypatch, secret_marker=secret_marker)
    grant = _grant(user=user, run_id=run.id)

    await gateway_service.call_provider_tool(
        db_session,
        grant=grant,
        provider=FUNCTION_INVOCATION_PROVIDER_NAMESPACE,
        tool="notify",
        arguments={"apiKey": secret_marker},
        activation_id=activation_id,
    )
    assert counter.last_arguments == {"apiKey": secret_marker}

    receipt = await ledger.get_gateway_receipt_by_activation(
        db_session, activation_id=activation_id
    )
    assert receipt is not None
    receipt_repr = repr(receipt)
    assert secret_marker not in receipt_repr
    # The receipt schema itself has no column that could ever carry arguments,
    # headers, or credentials — enumerate the exact public field set.
    assert set(receipt.__dataclass_fields__) == {
        "id",
        "run_id",
        "plan_hash",
        "slot_id",
        "session_id",
        "step_key",
        "attempt",
        "turn_id",
        "activation_id",
        "capability_kind",
        "provider_definition_id",
        "provider_revision",
        "tool_name",
        "input_schema_hash",
        "function_definition_id",
        "semantic_revision",
        "authorization_decision",
        "outcome",
        "created_at",
        "completed_at",
    }

    found = await activation_receipts.get_activation_and_receipt(
        db_session, run_id=run.id, activation_id=activation_id
    )
    assert found is not None
    activation, queried_receipt = found
    assert secret_marker not in repr(activation)
    assert queried_receipt is not None and secret_marker not in repr(queried_receipt)
