"""WS2b: secret-free plan, canonical plan hash, immutable ledger, redaction.

Tier-1 against a real DB. Proves the redaction cutover (completion plan §2.2/§2.3):
the plaintext run gateway bearer no longer rides inside ``resolved_plan_json`` and
is never returned by ordinary run APIs — it lives in the private envelope and is
folded into the delivered plan only on the delivery/claim paths. Also pins the
canonical planHash + plan_version, the additive v2 step keys, the desired/delivery
state axes at StartRun, and the immutable-ledger guard.
"""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import WORKFLOW_TARGET_MODE_LOCAL
from proliferate.db.models.auth import User
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store.cloud_workflows import WorkflowLedgerImmutableError
from proliferate.server.cloud.workflows import compiler
from proliferate.server.cloud.workflows.contracts import content_hash
from proliferate.server.cloud.workflows.contracts.verify import CANARY_MARKER
from proliferate.server.cloud.workflows.domain.definition import parse_definition
from proliferate.server.cloud.workflows.models import build_delivered_plan, run_payload

pytestmark = pytest.mark.asyncio


def _definition() -> dict:
    return {
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
    }


async def _make_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"sf-{uuid.uuid4().hex}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


async def _start_local_run(db: AsyncSession):
    user = await _make_user(db)
    canonical, _specs = parse_definition(_definition(), require_steps=False)
    workflow, _version = await store.create_workflow_with_version(
        db,
        owner_user_id=user.id,
        created_by_user_id=user.id,
        name=f"wf-{uuid.uuid4().hex[:6]}",
        description=None,
        definition_json=canonical,
    )
    run = await compiler.start_run(
        db, user, workflow.id, inputs={}, target_mode=WORKFLOW_TARGET_MODE_LOCAL
    )
    return user, run


# --- secret-free plan + envelope split -----------------------------------------


async def test_startrun_splits_plan_and_envelope(db_session: AsyncSession) -> None:
    _user, run = await _start_local_run(db_session)
    # The gateway block (bearer) is in the private envelope, never the logical plan.
    assert "gateway" not in run.resolved_plan_json
    gateway = run.private_envelope_json["gateway"]
    assert gateway["authorization"].startswith("Bearer ")
    assert gateway["ping_url"].endswith(f"/v1/cloud/workflows/runs/{run.id}/ping")


async def test_public_run_apis_never_carry_the_credential(db_session: AsyncSession) -> None:
    """Mint a run whose envelope holds the credential canary; assert every public
    run-API serialization lacks it while the delivered payload carries it."""
    _user, run = await _start_local_run(db_session)
    # Plant the canary marker inside the envelope's bearer.
    envelope = {"gateway": {"authorization": f"Bearer {CANARY_MARKER}", "integrations": []}}
    updated = await store.update_run(db_session, run_id=run.id, private_envelope_json=envelope)
    assert updated is not None

    # Ordinary run APIs serialize via run_payload with include_private_envelope=False.
    public = run_payload(updated).model_dump(by_alias=True)
    assert CANARY_MARKER not in json.dumps(public)
    assert "gateway" not in public["resolvedPlan"]

    # A re-read run row (list/detail path) still lacks it.
    reread = await store.get_run(db_session, run.id)
    assert CANARY_MARKER not in json.dumps(run_payload(reread).model_dump(by_alias=True))

    # The delivery/claim path (include_private_envelope=True) DOES carry it.
    delivered = run_payload(updated, include_private_envelope=True).model_dump(by_alias=True)
    assert CANARY_MARKER in json.dumps(delivered)
    assert delivered["resolvedPlan"]["gateway"]["authorization"] == f"Bearer {CANARY_MARKER}"


# --- canonical plan hash + version + state axes --------------------------------


async def test_plan_hash_matches_canonical_content_hash(db_session: AsyncSession) -> None:
    _user, run = await _start_local_run(db_session)
    assert run.plan_hash == content_hash(run.resolved_plan_json)
    assert run.plan_hash.startswith("sha256:")
    assert run.plan_version == 2


async def test_state_axes_written_at_startrun(db_session: AsyncSession) -> None:
    _user, run = await _start_local_run(db_session)
    assert run.desired_state == "running"
    assert run.delivery_state == "ready"
    # Legacy status still drives current code (no consumer cutover yet).
    assert run.status == "pending_delivery"


async def test_delivered_payload_pins_hash_and_version(db_session: AsyncSession) -> None:
    _user, run = await _start_local_run(db_session)
    gateway = run.private_envelope_json["gateway"]
    delivered = build_delivered_plan(
        run.resolved_plan_json,
        gateway=gateway,
        plan_hash=run.plan_hash,
        plan_version=run.plan_version,
    )
    assert delivered["planHash"] == run.plan_hash
    assert delivered["planVersion"] == 2
    assert delivered["gateway"] == gateway
    # The steps + sessions logical body is preserved verbatim.
    assert delivered["steps"] == run.resolved_plan_json["steps"]


# --- v2 step keys ---------------------------------------------------------------


async def test_v2_step_keys_ride_alongside_legacy(db_session: AsyncSession) -> None:
    _user, run = await _start_local_run(db_session)
    steps = run.resolved_plan_json["steps"]
    assert steps, "expected at least one plan step"
    for step in steps:
        # Legacy key still present + drives the runtime.
        assert step["key"] == "0.-.0" or step["key"].startswith("0.")
        key_v2 = step["key_v2"]
        parts = key_v2.split("::")
        assert parts[0] == "root"
        assert len(parts) == 4  # root::<node-id>::<lane-id or ->::<step-id>
        assert parts[2] == "-"  # standalone (non-parallel) node
        # node-id and step-id are lowercase UUIDv5s.
        uuid.UUID(parts[1])
        uuid.UUID(parts[3])


# --- immutable ledger guard -----------------------------------------------------


async def test_resolved_plan_is_immutable_after_creation(db_session: AsyncSession) -> None:
    _user, run = await _start_local_run(db_session)
    with pytest.raises(WorkflowLedgerImmutableError):
        await store.update_run(
            db_session, run_id=run.id, resolved_plan_json={"steps": [], "sessions": {}}
        )
    # The private envelope, by contrast, is freely re-writable (delivery/claim fold).
    updated = await store.update_run(
        db_session, run_id=run.id, private_envelope_json={"gateway": {"integrations": ["x"]}}
    )
    assert updated is not None
    assert updated.private_envelope_json["gateway"]["integrations"] == ["x"]
