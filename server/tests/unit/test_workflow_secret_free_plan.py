"""Secret-free plan, canonical plan hash, immutable ledger, and redaction.

Tier-1 against a real DB. Proves the redaction cutover (completion plan §2.2/§2.3):
no bearer rides inside ``resolved_plan_json`` or is minted before binding, and an
artificial private-envelope canary is never returned by ordinary run APIs. Also pins the
canonical planHash + plan_version, the additive v2 step keys, the desired/delivery
state axes at StartRun, and the immutable-ledger guard.
"""

from __future__ import annotations

import copy
import inspect
import json
import logging
import uuid

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import (
    WORKFLOW_INT32_MAX,
    WORKFLOW_JSON_SAFE_INTEGER_MAX,
    WORKFLOW_TARGET_MODE_LOCAL,
    WORKFLOW_UINT32_MAX,
)
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.workflows import WorkflowRun
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store.cloud_workflows import WorkflowLedgerImmutableError
from proliferate.db.store.workflow_ledger import legacy_tokens as legacy_token_store
from proliferate.server.cloud.workflows import (
    compiler,
    gateway_grants,
    models as workflow_models,
)
from proliferate.server.cloud.workflows.contracts import canonicalize, fixtures
from proliferate.server.cloud.workflows.contracts.models import LegacyResolvedPlanV1
from proliferate.server.cloud.workflows.contracts.models import plan_hash as compute_plan_hash
from proliferate.server.cloud.workflows.contracts.verify import CANARY_MARKER
from proliferate.server.cloud.workflows.domain.definition import (
    WorkflowDefinitionError,
    parse_definition,
)
from proliferate.server.cloud.workflows.models import run_payload

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
        db,
        user,
        workflow.id,
        inputs={},
        target_mode=WORKFLOW_TARGET_MODE_LOCAL,
        target_workspace_id=uuid.uuid4(),
    )
    return user, run


# --- secret-free plan + envelope split -----------------------------------------


async def test_startrun_mints_no_execution_envelope(db_session: AsyncSession) -> None:
    _user, run = await _start_local_run(db_session)
    # WF-ID records only the logical plan. WF-CRED owns the later final envelope.
    assert "gateway" not in run.resolved_plan_json
    assert not hasattr(run, "private_envelope_json")


async def test_legacy_envelope_is_absent_from_value_repr_api_and_logs(
    db_session: AsyncSession,
    caplog: pytest.LogCaptureFixture,
) -> None:
    _user, run = await _start_local_run(db_session)
    legacy_row = await db_session.get(WorkflowRun, run.id)
    assert legacy_row is not None
    legacy_row.private_envelope_json = {
        "gateway": {
            "authorization": f"Bearer {CANARY_MARKER}",
            "integrations": [],
        }
    }
    legacy_row.resolved_plan_json = {
        **legacy_row.resolved_plan_json,
        "gateway": {"authorization": f"Bearer {CANARY_MARKER}"},
    }
    await db_session.flush()

    reread = await store.get_run(db_session, run.id)
    assert reread is not None and not hasattr(reread, "private_envelope_json")
    public = run_payload(reread).model_dump(by_alias=True)
    assert CANARY_MARKER not in json.dumps(public)
    assert "gateway" not in public["resolvedPlan"]
    assert CANARY_MARKER not in repr(legacy_row)
    assert CANARY_MARKER not in repr(reread)
    with caplog.at_level(logging.WARNING):
        logging.getLogger("workflow.legacy.canary").warning(
            "legacy=%r record=%r", legacy_row, reread
        )
    assert CANARY_MARKER not in caplog.text


async def test_no_callable_store_or_serializer_can_write_or_emit_legacy_envelope() -> None:
    assert "private_envelope_json" not in inspect.signature(store.create_run).parameters
    assert "private_envelope_json" not in inspect.signature(store.update_run).parameters
    assert "include_private_envelope" not in inspect.signature(run_payload).parameters
    assert not hasattr(workflow_models, "build_delivered_plan")
    assert not hasattr(gateway_grants, "mint_run_gateway_token")
    assert not hasattr(gateway_grants, "rotate_run_gateway_token")
    assert not hasattr(gateway_grants, "build_gateway_plan_block")
    assert not hasattr(legacy_token_store, "create_run_gateway_token")
    assert not hasattr(legacy_token_store, "refreeze_run_gateway_token_scope")
    assert not hasattr(legacy_token_store, "expire_run_gateway_tokens_for_run")


# --- canonical plan hash + version + state axes --------------------------------


async def test_plan_hash_matches_canonical_content_hash(db_session: AsyncSession) -> None:
    _user, run = await _start_local_run(db_session)
    assert run.plan_hash == compute_plan_hash(run.resolved_plan_json)
    assert run.plan_hash.startswith("sha256:")
    assert run.plan_version == 1


async def test_state_axes_written_at_startrun(db_session: AsyncSession) -> None:
    _user, run = await _start_local_run(db_session)
    assert run.desired_state == "running"
    assert run.delivery_state == "ready"
    assert run.status == "claimable"


async def test_public_payload_pins_hash_and_version(db_session: AsyncSession) -> None:
    _user, run = await _start_local_run(db_session)
    public = run_payload(run).model_dump(by_alias=True)["resolvedPlan"]
    assert public["planHash"] == run.plan_hash
    assert public["planVersion"] == 1
    assert "gateway" not in public
    # The steps + sessions logical body is preserved verbatim.
    assert public["steps"] == run.resolved_plan_json["steps"]


async def test_legacy_plan_identity_accepts_only_wire_aliases(
    db_session: AsyncSession,
) -> None:
    _user, run = await _start_local_run(db_session)
    raw = dict(run.resolved_plan_json)
    raw["plan_version"] = raw.pop("planVersion")
    with pytest.raises(ValidationError):
        LegacyResolvedPlanV1.model_validate(raw)


@pytest.mark.parametrize(
    "mutation",
    [
        lambda plan: plan.__setitem__("opaqueEnvelope", {"nested": "canary"}),
        lambda plan: plan["sessions"]["main"].__setitem__("opaque", {"nested": "canary"}),
        lambda plan: plan["steps"][0].__setitem__("opaque", {"nested": "canary"}),
        lambda plan: plan["inputs"].__setitem__("api_key", "secret-canary"),
        lambda plan: plan["inputs"].__setitem__("safe", {"token": "secret-canary"}),
        lambda plan: plan.__setitem__("planHash", "sha256:" + "A" * 64),
        lambda plan: plan.__setitem__("run_id", plan["run_id"].upper()),
        lambda plan: plan.__setitem__("trigger_kind", "webhook"),
    ],
)
async def test_legacy_plan_identity_rejects_unknown_nested_or_noncanonical_content(
    db_session: AsyncSession,
    mutation,  # type: ignore[no-untyped-def]
) -> None:
    _user, run = await _start_local_run(db_session)
    raw = copy.deepcopy(run.resolved_plan_json)
    mutation(raw)
    with pytest.raises(ValidationError):
        LegacyResolvedPlanV1.model_validate(raw)


async def test_legacy_plan_identity_rejects_source_alias_and_ref_smuggling(
    db_session: AsyncSession,
) -> None:
    _user, run = await _start_local_run(db_session)

    alias = copy.deepcopy(run.resolved_plan_json)
    alias["sourceIntent"] = {
        "kind": "remote_commit",
        "repo": "github.com/acme/widgets",
        "ref": "refs/heads/main",
        "resolved_commit": "a" * 40,
    }
    alias["target_mode"] = "personal_cloud"
    with pytest.raises(ValidationError):
        LegacyResolvedPlanV1.model_validate(alias)

    malformed_ref = copy.deepcopy(alias)
    malformed_ref["sourceIntent"].pop("resolved_commit")
    malformed_ref["sourceIntent"]["resolvedCommit"] = "a" * 40
    malformed_ref["sourceIntent"]["ref"] = "refs/heads/main..credential"
    with pytest.raises(ValidationError):
        LegacyResolvedPlanV1.model_validate(malformed_ref)


async def test_legacy_plan_identity_allows_auth_discussion_as_ordinary_text(
    db_session: AsyncSession,
) -> None:
    _user, run = await _start_local_run(db_session)
    raw = copy.deepcopy(run.resolved_plan_json)
    raw["inputs"]["topic"] = "Explain the HTTP Bearer authentication scheme"
    raw["steps"][0]["prompt"] = "Document a Bearer header without embedding a credential."
    LegacyResolvedPlanV1.model_validate(raw)


@pytest.mark.parametrize(
    "private_alias",
    [
        "auth_token",
        "bearer-token",
        "clientSecret",
        "private_key",
        "access-key",
        "secret_access_key",
        "sessionToken",
    ],
)
async def test_legacy_plan_identity_rejects_normalized_private_input_aliases(
    db_session: AsyncSession,
    private_alias: str,
) -> None:
    _user, run = await _start_local_run(db_session)
    raw = copy.deepcopy(run.resolved_plan_json)
    raw["inputs"][private_alias] = "credential-canary"
    with pytest.raises(ValidationError):
        LegacyResolvedPlanV1.model_validate(raw)


@pytest.mark.parametrize("non_finite", [float("nan"), float("inf"), float("-inf")])
async def test_legacy_plan_identity_rejects_non_finite_inputs(
    db_session: AsyncSession,
    non_finite: float,
) -> None:
    _user, run = await _start_local_run(db_session)
    raw = copy.deepcopy(run.resolved_plan_json)
    raw["inputs"]["quantity"] = non_finite
    with pytest.raises(ValidationError):
        LegacyResolvedPlanV1.model_validate(raw)

    raw = dict(run.resolved_plan_json)
    source = dict(raw["sourceIntent"])
    source["resolved_commit"] = source.pop("resolvedCommit", None)
    raw["sourceIntent"] = source
    with pytest.raises(ValidationError):
        LegacyResolvedPlanV1.model_validate(raw)


def _maximum_integer_definition() -> dict[str, object]:
    return {
        "version": 1,
        "inputs": [],
        "integrations": [],
        "agents": [
            {
                "slot": "main",
                "harness": "claude",
                "model": "sonnet",
                "steps": [
                    {
                        "kind": "agent.config",
                        "model": "sonnet",
                    },
                    {
                        "kind": "agent.prompt",
                        "prompt": "work",
                        "on_fail": {"kind": "retry", "n": WORKFLOW_UINT32_MAX},
                        "goal": {
                            "objective": "finish",
                            "max_turns": WORKFLOW_UINT32_MAX,
                            "max_wall_secs": WORKFLOW_JSON_SAFE_INTEGER_MAX,
                            "token_budget": WORKFLOW_JSON_SAFE_INTEGER_MAX,
                            "on_blocked": "fail",
                            "verify": {"shell": "true", "expect_exit": WORKFLOW_INT32_MAX},
                        },
                    },
                    {
                        "kind": "agent.emit",
                        "prompt": "emit",
                        "name": "result",
                        "max_attempts": WORKFLOW_UINT32_MAX,
                    },
                    {
                        "kind": "shell.run",
                        "command": "true",
                        "timeout_secs": WORKFLOW_JSON_SAFE_INTEGER_MAX,
                    },
                ],
            }
        ],
    }


def _set_json_pointer(document: object, pointer: str, value: object) -> None:
    current = document
    parts = pointer.removeprefix("/").split("/")
    for part in parts[:-1]:
        current = current[int(part)] if isinstance(current, list) else current[part]  # type: ignore[index]
    if isinstance(current, list):
        current[int(parts[-1])] = value
    else:
        current[parts[-1]] = value  # type: ignore[index]


async def test_startrun_produces_a_strict_plan_at_every_frozen_integer_maximum(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    canonical, _specs = parse_definition(_maximum_integer_definition())
    workflow, _version = await store.create_workflow_with_version(
        db_session,
        owner_user_id=user.id,
        created_by_user_id=user.id,
        name=f"wf-max-{uuid.uuid4().hex[:6]}",
        description=None,
        definition_json=canonical,
    )
    run = await compiler.start_run(
        db_session,
        user,
        workflow.id,
        inputs={},
        target_mode=WORKFLOW_TARGET_MODE_LOCAL,
        target_workspace_id=uuid.uuid4(),
    )
    LegacyResolvedPlanV1.model_validate(run.resolved_plan_json)
    assert run.plan_hash == compute_plan_hash(run.resolved_plan_json)


async def test_legacy_plan_integer_domains_follow_shared_boundary_vectors(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    canonical, _specs = parse_definition(_maximum_integer_definition())
    workflow, _version = await store.create_workflow_with_version(
        db_session,
        owner_user_id=user.id,
        created_by_user_id=user.id,
        name=f"wf-vectors-{uuid.uuid4().hex[:6]}",
        description=None,
        definition_json=canonical,
    )
    run = await compiler.start_run(
        db_session,
        user,
        workflow.id,
        inputs={},
        target_mode=WORKFLOW_TARGET_MODE_LOCAL,
        target_workspace_id=uuid.uuid4(),
    )
    vectors = fixtures.load("canonical-structure-vectors-v1.json")["legacyIntegerDomains"]
    for vector in vectors:
        accepted = copy.deepcopy(run.resolved_plan_json)
        _set_json_pointer(accepted, vector["planPointer"], vector["maximum"])
        LegacyResolvedPlanV1.model_validate(accepted)
        if vector["minimum"] < 0:
            accepted_min = copy.deepcopy(run.resolved_plan_json)
            _set_json_pointer(accepted_min, vector["planPointer"], vector["minimum"])
            LegacyResolvedPlanV1.model_validate(accepted_min)
        for rejected_value in (vector["belowMinimum"], vector["aboveMaximum"]):
            rejected = copy.deepcopy(run.resolved_plan_json)
            _set_json_pointer(rejected, vector["planPointer"], rejected_value)
            with pytest.raises(ValidationError):
                LegacyResolvedPlanV1.model_validate(rejected)


@pytest.mark.parametrize(
    ("field", "above_maximum"),
    [
        ("on_fail.n", WORKFLOW_UINT32_MAX + 1),
        ("goal.max_turns", WORKFLOW_UINT32_MAX + 1),
        ("goal.max_wall_secs", WORKFLOW_JSON_SAFE_INTEGER_MAX + 1),
        ("goal.token_budget", WORKFLOW_JSON_SAFE_INTEGER_MAX + 1),
        ("goal.verify.expect_exit", WORKFLOW_INT32_MAX + 1),
        ("agent.emit.max_attempts", WORKFLOW_UINT32_MAX + 1),
        ("shell.run.timeout_secs", WORKFLOW_JSON_SAFE_INTEGER_MAX + 1),
    ],
)
async def test_definition_save_rejects_every_integer_maximum_plus_one(
    field: str,
    above_maximum: int,
) -> None:
    definition = _maximum_integer_definition()
    steps = definition["agents"][0]["steps"]  # type: ignore[index]
    targets: dict[str, tuple[dict[str, object], str]] = {
        "on_fail.n": (steps[1]["on_fail"], "n"),
        "goal.max_turns": (steps[1]["goal"], "max_turns"),
        "goal.max_wall_secs": (steps[1]["goal"], "max_wall_secs"),
        "goal.token_budget": (steps[1]["goal"], "token_budget"),
        "goal.verify.expect_exit": (steps[1]["goal"]["verify"], "expect_exit"),
        "agent.emit.max_attempts": (steps[2], "max_attempts"),
        "shell.run.timeout_secs": (steps[3], "timeout_secs"),
    }
    owner, key = targets[field]
    owner[key] = above_maximum
    with pytest.raises(WorkflowDefinitionError):
        parse_definition(definition)


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


# --- fractional number inputs (WS1-follow-up float fix) -------------------------
#
# WS2b discovered that a workflow `number` input with a fractional value (e.g.
# 1.5) would fail StartRun: the canonicalizer rejected any non-integer float,
# and `plan_hash = content_hash(resolved_plan)` hashes `resolved_plan["inputs"]`
# verbatim. The captain ruling was to fix the canonicalizers (RFC 8785 §3.2.2.3
# ECMAScript Number::toString) rather than ban fractional inputs — these prove
# that fix end-to-end through the real StartRun path, not just the canonical.py
# unit.


def _definition_with_number_input(*, default: float) -> dict:
    return {
        "version": 1,
        "inputs": [{"name": "quantity", "type": "number", "default": default}],
        "integrations": [],
        "agents": [
            {
                "slot": "main",
                "harness": "claude",
                "model": "sonnet",
                "steps": [{"kind": "agent.prompt", "prompt": "process {{inputs.quantity}}"}],
            }
        ],
    }


async def _start_local_run_with_number_input(
    db: AsyncSession, *, default: float, inputs: dict[str, object]
):
    user = await _make_user(db)
    canonical, _specs = parse_definition(
        _definition_with_number_input(default=default), require_steps=False
    )
    workflow, _version = await store.create_workflow_with_version(
        db,
        owner_user_id=user.id,
        created_by_user_id=user.id,
        name=f"wf-{uuid.uuid4().hex[:6]}",
        description=None,
        definition_json=canonical,
    )
    run = await compiler.start_run(
        db,
        user,
        workflow.id,
        inputs=inputs,
        target_mode=WORKFLOW_TARGET_MODE_LOCAL,
        target_workspace_id=uuid.uuid4(),
    )
    return user, run


async def test_startrun_hashes_a_fractional_number_input_default(
    db_session: AsyncSession,
) -> None:
    """A workflow whose `number` input's *default* is fractional (1.5, not
    overridden at StartRun) must compile and hash successfully — this is the
    exact shape WS2b found broken before the float canonicalization fix."""
    _user, run = await _start_local_run_with_number_input(db_session, default=1.5, inputs={})
    assert run.resolved_plan_json["inputs"]["quantity"] == 1.5
    # The plan hash must round-trip: recomputing the plan hash over the stored
    # plan reproduces the persisted plan_hash exactly.
    assert run.plan_hash == compute_plan_hash(run.resolved_plan_json)
    assert run.plan_hash.startswith("sha256:")


async def test_startrun_hashes_a_fractional_startrun_input_override(
    db_session: AsyncSession,
) -> None:
    """A fractional value supplied at StartRun (overriding an integral default)
    must also compile and hash successfully."""
    _user, run = await _start_local_run_with_number_input(
        db_session, default=1, inputs={"quantity": 2.75}
    )
    assert run.resolved_plan_json["inputs"]["quantity"] == 2.75
    assert run.plan_hash == compute_plan_hash(run.resolved_plan_json)
    assert run.plan_hash.startswith("sha256:")


async def test_startrun_hashes_an_integral_number_input_without_trailing_zero(
    db_session: AsyncSession,
) -> None:
    """An integral float input (e.g. 2.0) must canonicalize as "2", not "2.0" —
    the RFC 8785 / ECMA-262 Number::toString rule the fix implements."""
    _user, run = await _start_local_run_with_number_input(
        db_session, default=1, inputs={"quantity": 2.0}
    )
    assert run.resolved_plan_json["inputs"]["quantity"] == 2.0
    canonical_bytes = canonicalize(run.resolved_plan_json)
    assert b'"quantity":2' in canonical_bytes
    assert b'"quantity":2.0' not in canonical_bytes
    assert run.plan_hash == compute_plan_hash(run.resolved_plan_json)


# --- immutable ledger guard -----------------------------------------------------


async def test_resolved_plan_is_immutable_after_creation(db_session: AsyncSession) -> None:
    _user, run = await _start_local_run(db_session)
    with pytest.raises(WorkflowLedgerImmutableError):
        await store.update_run(
            db_session, run_id=run.id, resolved_plan_json={"steps": [], "sessions": {}}
        )
