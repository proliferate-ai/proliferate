"""WS3a — exact capability grants frozen at StartRun + live narrowing (§7.1).

Tier-1 against real Postgres. Proves the packet's acceptance floor:

- StartRun freezes EXACT per-slot ``CapabilityRef`` leases (functions at their
  ``semantic_revision``; integration tools at ``(providerDefinitionId,
  providerRevision, toolName, inputSchemaHash)`` from the warm tool cache).
- A function/tool created after StartRun has no frozen lease: absent from the
  leases and DENIED at dispatch (no-widening).
- A per-slot subset narrows: slot A's lease exists, slot B's is absent, and
  ``authorize_capability`` denies slot B for the same capability.
- Archive/revoke/edit after the freeze denies the NEXT authorization decision —
  no positive cache.
- The canonical ``capability_key`` format round-trips, including components
  that themselves contain colons.
- Legacy runs (no leases) keep namespace-only gateway behavior.

The §7.2 semantic-revision bump rules + the WS3a populated-DB migration test
live in ``test_workflow_capability_revisions.py``.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import FUNCTION_INVOCATION_PROVIDER_NAMESPACE
from proliferate.db.models.cloud.workflow_ledger import WorkflowCapabilityLease
from proliferate.db.store import function_invocations as invocations_store
from proliferate.db.store.runtime_workers import IntegrationGatewayGrant
from proliferate.db.store.workflow_ledger import gateway as ledger_gateway
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integration_gateway import service as gateway_service
from proliferate.server.cloud.workflows import capability_authz
from proliferate.server.cloud.workflows.capability_authz import CapabilityRunContext
from proliferate.server.cloud.workflows.domain.capabilities import (
    CAPABILITY_INPUT_SCHEMA_UNKNOWN,
    FunctionRef,
    IntegrationToolRef,
    ProductMcpRef,
    input_schema_hash,
    parse_capability_key,
)
from tests.unit.workflow_capability_helpers import (
    definition,
    make_user,
    seed_invocation,
    seed_ready_account,
    start_run,
    store_workflow,
    warm_tool_cache,
)
from tests.unit.workflow_ledger_helpers import make_run

pytestmark = pytest.mark.asyncio

_FN = FUNCTION_INVOCATION_PROVIDER_NAMESPACE


# --- capability_key canonical format ------------------------------------------------


async def test_capability_key_round_trip_all_kinds() -> None:
    """The canonical key format encodes and decodes losslessly for every union
    arm — including a colon-bearing providerRevision (an ``updated_at``
    isoformat), which must percent-quote rather than corrupt the key."""

    tool = IntegrationToolRef(
        provider_definition_id="0d5a8c1e-1111-2222-3333-444455556666",
        provider_revision="2026-07-10T12:34:56+00:00",
        tool_name="create_issue",
        input_schema_hash="sha256:" + "a" * 64,
    )
    parsed = parse_capability_key(tool.capability_key)
    assert parsed.kind == "integration_tool"
    assert parsed.provider_definition_id == tool.provider_definition_id
    assert parsed.provider_revision == tool.provider_revision
    assert parsed.tool_name == tool.tool_name

    fn = FunctionRef(definition_id=str(uuid.uuid4()), semantic_revision=3)
    parsed_fn = parse_capability_key(fn.capability_key)
    assert parsed_fn.kind == "function"
    assert parsed_fn.definition_id == fn.definition_id
    assert parsed_fn.semantic_revision == 3

    mcp = ProductMcpRef(definition="workflow_peer", policy_revision=1)
    parsed_mcp = parse_capability_key(mcp.capability_key)
    assert parsed_mcp.kind == "product_mcp"
    assert parsed_mcp.product_mcp_definition == "workflow_peer"
    assert parsed_mcp.policy_revision == 1

    with pytest.raises(ValueError):
        parse_capability_key("integration_tool:only:two")
    with pytest.raises(ValueError):
        parse_capability_key("mystery:whatever:1")


async def test_input_schema_hash_sentinel_and_stability() -> None:
    """No schema -> the explicit 'unknown' sentinel (never a fake hash); an
    identical schema hashes identically regardless of key order."""

    assert input_schema_hash(None) == CAPABILITY_INPUT_SCHEMA_UNKNOWN
    assert input_schema_hash({}) == CAPABILITY_INPUT_SCHEMA_UNKNOWN
    a = input_schema_hash({"type": "object", "properties": {"x": {"type": "string"}}})
    b = input_schema_hash({"properties": {"x": {"type": "string"}}, "type": "object"})
    assert a == b
    assert a.startswith("sha256:")


# --- StartRun freezes exact refs (no-widening) ---------------------------------------


async def test_start_run_freezes_exact_function_refs(db_session: AsyncSession) -> None:
    """StartRun persists one function lease per live owner invocation, at its
    current semantic revision; a function created AFTER StartRun is absent from
    the frozen leases and denied at dispatch."""

    user = await make_user(db_session)
    fn_a = await seed_invocation(db_session, owner=user, name="fn_a")
    wf = await store_workflow(db_session, user, definition(integrations=[_FN]), name="freeze-fns")
    run = await start_run(db_session, user, wf.id)

    leases = await ledger_gateway.list_capability_leases(db_session, run_id=run.id)
    assert [
        (lease.slot_id, lease.kind, lease.function_definition_id, lease.semantic_revision)
        for lease in leases
    ] == [("main", "function", str(fn_a.id), 1)]
    assert (
        leases[0].capability_key
        == FunctionRef(definition_id=str(fn_a.id), semantic_revision=1).capability_key
    )

    # Created after StartRun: not in the frozen leases, denied at dispatch.
    await seed_invocation(db_session, owner=user, name="fn_late")
    ctx = CapabilityRunContext(run_id=run.id, owner_user_id=user.id)
    decision = await capability_authz.authorize_dispatch(
        db_session, run=ctx, provider=_FN, tool="fn_late"
    )
    assert not decision.allowed
    assert decision.reason == capability_authz.CAPABILITY_DENY_NO_LEASE
    # The frozen truth did not widen.
    after = await ledger_gateway.list_capability_leases(db_session, run_id=run.id)
    assert len(after) == 1

    # The frozen function still authorizes.
    allowed = await capability_authz.authorize_dispatch(
        db_session, run=ctx, provider=_FN, tool="fn_a"
    )
    assert allowed.allowed


async def test_start_run_freezes_integration_tools_from_warm_cache(
    db_session: AsyncSession,
) -> None:
    """A warm tool cache freezes exact (providerDefinitionId, providerRevision,
    toolName, inputSchemaHash) refs; a tool appearing in the cache after
    StartRun is denied for the frozen run."""

    user = await make_user(db_session)
    account, seed_def = await seed_ready_account(db_session, user_id=user.id, namespace="context7")
    schema = {"type": "object", "properties": {"library": {"type": "string"}}}
    await warm_tool_cache(
        db_session,
        account_id=account.id,
        tools=[
            {"name": "resolve_library", "inputSchema": schema},
            {"name": "get_docs"},  # no schema cached -> explicit 'unknown'
        ],
    )
    wf = await store_workflow(
        db_session, user, definition(integrations=["context7"]), name="freeze-tools"
    )
    run = await start_run(db_session, user, wf.id)

    leases = await ledger_gateway.list_capability_leases(db_session, run_id=run.id)
    by_tool = {lease.tool_name: lease for lease in leases}
    assert set(by_tool) == {"resolve_library", "get_docs"}
    for lease in leases:
        assert lease.kind == "integration_tool"
        assert lease.slot_id == "main"
        assert lease.provider_definition_id == str(seed_def.id)
        assert lease.provider_revision == seed_def.updated_at.isoformat()
    assert by_tool["resolve_library"].input_schema_hash == input_schema_hash(schema)
    assert by_tool["get_docs"].input_schema_hash == CAPABILITY_INPUT_SCHEMA_UNKNOWN

    ctx = CapabilityRunContext(run_id=run.id, owner_user_id=user.id)
    assert (
        await capability_authz.authorize_dispatch(
            db_session, run=ctx, provider="context7", tool="resolve_library"
        )
    ).allowed

    # A tool that shows up upstream after StartRun cannot widen the frozen run.
    await warm_tool_cache(
        db_session,
        account_id=account.id,
        tools=[
            {"name": "resolve_library", "inputSchema": schema},
            {"name": "get_docs"},
            {"name": "brand_new_tool"},
        ],
    )
    denied = await capability_authz.authorize_dispatch(
        db_session, run=ctx, provider="context7", tool="brand_new_tool"
    )
    assert not denied.allowed
    assert denied.reason == capability_authz.CAPABILITY_DENY_NO_LEASE


async def test_cold_tool_cache_freezes_no_integration_leases(
    db_session: AsyncSession,
) -> None:
    """E3 forbids a tools/list fetch at mint: a cold cache freezes nothing for
    that provider (namespace token still governs; WS3c tightens), and dispatch
    falls back to allow — never a fake hash, never a fabricated tool list."""

    user = await make_user(db_session)
    await seed_ready_account(db_session, user_id=user.id, namespace="context7")
    wf = await store_workflow(
        db_session, user, definition(integrations=["context7"]), name="cold-cache"
    )
    run = await start_run(db_session, user, wf.id)
    leases = await ledger_gateway.list_capability_leases(db_session, run_id=run.id)
    assert leases == ()

    ctx = CapabilityRunContext(run_id=run.id, owner_user_id=user.id)
    decision = await capability_authz.authorize_dispatch(
        db_session, run=ctx, provider="context7", tool="anything"
    )
    assert decision.allowed  # legacy-parallel: namespace layer governs


# --- slot subset narrowing -----------------------------------------------------------


async def test_slot_subset_narrows_and_authorize_capability_is_per_slot(
    db_session: AsyncSession,
) -> None:
    """Slot A (unnarrowed) gets the function lease; slot B (narrowed to []) gets
    none — the SAME capability_key authorizes for A and is denied for B."""

    user = await make_user(db_session)
    fn = await seed_invocation(db_session, owner=user, name="fn_shared")
    definition_json = definition(
        integrations=[_FN],
        agents=[
            {
                "slot": "worker_a",
                "harness": "claude",
                "model": "sonnet",
                "steps": [{"kind": "agent.prompt", "prompt": "hi"}],
            },
            {
                "slot": "worker_b",
                "harness": "claude",
                "model": "sonnet",
                "steps": [{"kind": "agent.prompt", "prompt": "hi"}],
                "integrations": [],
            },
        ],
    )
    wf = await store_workflow(db_session, user, definition_json, name="slot-narrow")
    run = await start_run(db_session, user, wf.id)

    leases = await ledger_gateway.list_capability_leases(db_session, run_id=run.id)
    assert [(lease.slot_id, lease.kind) for lease in leases] == [("worker_a", "function")]
    key = FunctionRef(definition_id=str(fn.id), semantic_revision=1).capability_key

    ctx = CapabilityRunContext(run_id=run.id, owner_user_id=user.id)
    allowed = await capability_authz.authorize_capability(
        db_session, run=ctx, slot_id="worker_a", capability_key=key
    )
    assert allowed.allowed
    denied = await capability_authz.authorize_capability(
        db_session, run=ctx, slot_id="worker_b", capability_key=key
    )
    assert not denied.allowed
    assert denied.reason == capability_authz.CAPABILITY_DENY_NO_LEASE


# --- live narrowing: archive / edit after freeze -------------------------------------


async def test_archive_after_freeze_denies_next_decision(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    fn = await seed_invocation(db_session, owner=user, name="fn_gone")
    wf = await store_workflow(
        db_session, user, definition(integrations=[_FN]), name="archive-denies"
    )
    run = await start_run(db_session, user, wf.id)
    key = FunctionRef(definition_id=str(fn.id), semantic_revision=1).capability_key
    ctx = CapabilityRunContext(run_id=run.id, owner_user_id=user.id)

    before = await capability_authz.authorize_capability(
        db_session, run=ctx, slot_id="main", capability_key=key
    )
    assert before.allowed

    assert await invocations_store.archive(db_session, owner_user_id=user.id, name="fn_gone")

    # No positive cache: the very next decision re-reads live state and denies.
    after = await capability_authz.authorize_capability(
        db_session, run=ctx, slot_id="main", capability_key=key
    )
    assert not after.allowed
    assert after.reason == capability_authz.CAPABILITY_DENY_REVOKED
    dispatch = await capability_authz.authorize_dispatch(
        db_session, run=ctx, provider=_FN, tool="fn_gone"
    )
    assert not dispatch.allowed


async def test_semantic_edit_after_freeze_denies_next_decision(
    db_session: AsyncSession,
) -> None:
    """An endpoint edit after StartRun bumps the semantic revision, so the run's
    frozen ``(id, rev=1)`` capability no longer matches live state — denied as a
    stale revision (§7.2: an edit cannot mutate a running workflow's meaning)."""

    user = await make_user(db_session)
    fn = await seed_invocation(db_session, owner=user, name="fn_edit")
    wf = await store_workflow(db_session, user, definition(integrations=[_FN]), name="edit-denies")
    run = await start_run(db_session, user, wf.id)
    key = FunctionRef(definition_id=str(fn.id), semantic_revision=1).capability_key
    ctx = CapabilityRunContext(run_id=run.id, owner_user_id=user.id)

    await invocations_store.update(
        db_session,
        owner_user_id=user.id,
        name="fn_edit",
        endpoint_url="https://example.com/hook-v2",
    )

    stale = await capability_authz.authorize_capability(
        db_session, run=ctx, slot_id="main", capability_key=key
    )
    assert not stale.allowed
    assert stale.reason == capability_authz.CAPABILITY_DENY_STALE_REVISION
    dispatch = await capability_authz.authorize_dispatch(
        db_session, run=ctx, provider=_FN, tool="fn_edit"
    )
    assert not dispatch.allowed
    assert dispatch.reason == capability_authz.CAPABILITY_DENY_NO_LEASE


async def test_secret_rotation_after_freeze_keeps_authorizing(
    db_session: AsyncSession,
) -> None:
    """§7.2: a secret-value-only rotation behind the same binding identity is NOT
    a semantic edit — the frozen capability keeps authorizing."""

    user = await make_user(db_session)
    fn = await seed_invocation(db_session, owner=user, name="fn_rotate")
    wf = await store_workflow(db_session, user, definition(integrations=[_FN]), name="rotate-ok")
    run = await start_run(db_session, user, wf.id)
    key = FunctionRef(definition_id=str(fn.id), semantic_revision=1).capability_key
    ctx = CapabilityRunContext(run_id=run.id, owner_user_id=user.id)

    await invocations_store.rotate_headers(
        db_session,
        owner_user_id=user.id,
        name="fn_rotate",
        headers={"authorization": "Bearer secret-2"},
    )

    decision = await capability_authz.authorize_capability(
        db_session, run=ctx, slot_id="main", capability_key=key
    )
    assert decision.allowed


# --- gateway dispatch wiring (both layers) -------------------------------------------


async def test_gateway_dispatch_enforces_leases_alongside_namespace(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Through ``call_provider_tool``: the namespace layer alone would allow any
    ``functions`` tool, but the frozen leases deny the after-StartRun function
    with the enumerated capability error; the frozen one dispatches."""

    user = await make_user(db_session)
    await seed_invocation(db_session, owner=user, name="fn_ok")
    wf = await store_workflow(
        db_session, user, definition(integrations=[_FN]), name="dispatch-wire"
    )
    run = await start_run(db_session, user, wf.id)
    await seed_invocation(db_session, owner=user, name="fn_after")

    grant = IntegrationGatewayGrant(
        owner_user_id=user.id,
        organization_id=None,
        run_id=run.id,
        run_scope=[{"provider": _FN}],
        worker_scope=None,
    )

    calls: list[str] = []

    async def _fake_invocation(db, *, owner_user_id, name, arguments):  # type: ignore[no-untyped-def]
        calls.append(name)
        return {"content": [], "isError": False}

    monkeypatch.setattr(
        "proliferate.server.cloud.integration_gateway.functions.call_invocation",
        _fake_invocation,
    )

    with pytest.raises(CloudApiError) as excinfo:
        await gateway_service.call_provider_tool(
            db_session, grant=grant, provider=_FN, tool="fn_after", arguments={}
        )
    assert excinfo.value.code == "integration_gateway_capability_denied"
    assert calls == []  # denied BEFORE any dispatch

    result = await gateway_service.call_provider_tool(
        db_session, grant=grant, provider=_FN, tool="fn_ok", arguments={}
    )
    assert result == {"content": [], "isError": False}
    assert calls == ["fn_ok"]


async def test_legacy_run_without_leases_keeps_namespace_only_behavior(
    db_session: AsyncSession,
) -> None:
    """A run with no lease rows (pre-WS3a / legacy) is untouched by the new
    layer: ``authorize_dispatch`` allows and the namespace check remains the
    only gate."""

    user = await make_user(db_session)
    run = await make_run(db_session, user)  # a bare run row: no leases ever frozen
    ctx = CapabilityRunContext(run_id=run.id, owner_user_id=user.id)
    decision = await capability_authz.authorize_dispatch(
        db_session, run=ctx, provider="context7", tool="anything"
    )
    assert decision.allowed


async def test_lease_uniqueness_per_run_slot_key(db_session: AsyncSession) -> None:
    """The DB uniqueness identity is (run, slot, capability_key) — the same key
    may freeze for two slots, never twice for one."""

    user = await make_user(db_session)
    run = await make_run(db_session, user)
    key = FunctionRef(definition_id=str(uuid.uuid4()), semantic_revision=1).capability_key
    await ledger_gateway.insert_capability_lease(
        db_session, run_id=run.id, slot_id="a", kind="function", capability_key=key
    )
    await ledger_gateway.insert_capability_lease(
        db_session, run_id=run.id, slot_id="b", kind="function", capability_key=key
    )
    with pytest.raises(IntegrityError):
        await ledger_gateway.insert_capability_lease(
            db_session, run_id=run.id, slot_id="a", kind="function", capability_key=key
        )
    await db_session.rollback()


async def test_lease_rows_visible_via_orm_after_start_run(db_session: AsyncSession) -> None:
    """The compiler writes leases in the same transaction as the run row (a
    failed resolution can never leave a dangling run)."""

    user = await make_user(db_session)
    await seed_invocation(db_session, owner=user, name="fn_tx")
    wf = await store_workflow(db_session, user, definition(integrations=[_FN]), name="tx-same")
    run = await start_run(db_session, user, wf.id)
    rows = (
        (
            await db_session.execute(
                select(WorkflowCapabilityLease).where(WorkflowCapabilityLease.run_id == run.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
