"""Secret-free workflow scopes and fail-closed legacy gateway seams.

Tier-1 uses a real DB. StartRun freezes public scope/readiness without minting a
run bearer; manually seeded legacy rows prove old auth surfaces stop at the WF-ID
feature-off gate. The remaining gateway tests cover the independent per-worker
chat policy and namespace enforcement paths.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import (
    WORKFLOW_TARGET_MODE_LOCAL,
    WORKFLOW_TARGET_MODE_PERSONAL_CLOUD,
)
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.integrations import (
    CloudIntegrationDefinition,
    CloudIntegrationPolicy,
)
from proliferate.db.models.cloud.runtime_workers import (
    CloudIntegrationGatewayToken,
    CloudRuntimeWorker,
)
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.workflow_gateway_models import WorkflowRunGatewayToken
from proliferate.db.models.cloud.workflows import WorkflowRun
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store import organizations as organization_store
from proliferate.db.store import runtime_workers as runtime_workers_store
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integration_gateway import dependencies as gateway_deps
from proliferate.server.cloud.integration_gateway import service as gateway_service
from proliferate.server.cloud.integration_gateway.domain import scope
from proliferate.server.cloud.integrations.seeds import sync_seed_definitions
from proliferate.server.cloud.workflows import compiler
from proliferate.server.cloud.workflows.domain.definition import parse_definition
from proliferate.utils.crypto import encrypt_json
from proliferate.utils.time import utcnow

pytestmark = pytest.mark.asyncio


def _definition(*, integrations: list[str] | None = None, steps: list[dict] | None = None) -> dict:
    """A minimal v2 definition: one agent node in slot ``main`` (E3 namespaces)."""
    return {
        "version": 1,
        "inputs": [],
        "integrations": integrations or [],
        "agents": [
            {
                "slot": "main",
                "harness": "claude",
                "model": "sonnet",
                "steps": steps or [{"kind": "agent.prompt", "prompt": "hi"}],
            }
        ],
    }


def _scope_json(namespaces: list[str]) -> dict:
    """The per-slot scope_json a single-slot (``main``) run stamps (§2.6, E3)."""
    return {"main": {"integrations": list(namespaces)}}


async def _make_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"gw-{uuid.uuid4().hex}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


async def _make_org(db: AsyncSession, owner: User) -> uuid.UUID:
    """Seed a real Organization with ``owner`` as an active member; return its id.

    Gate C: main hardened ``CloudIntegrationPolicy.organization_id`` / the
    runtime-worker enrollment with real FKs to ``organization.id`` AND added
    per-request org-membership re-validation in the gateway dependency, so a
    fabricated org id (no row, no membership) no longer works — the worker's
    owner must be an active member of the org it is scoped to.
    """
    records = await organization_store.ensure_default_organization_for_user(
        db, user_id=owner.id, name=f"org-{uuid.uuid4().hex[:8]}", logo_domain=None
    )
    await db.flush()
    return records[0].organization.id


async def _seed_ready_account(db: AsyncSession, *, user_id: uuid.UUID, namespace: str) -> None:
    await sync_seed_definitions(db)
    await db.flush()
    definition = await definitions_store.get_seed_by_namespace(db, namespace)
    assert definition is not None
    account = await accounts_store.upsert_account(
        db, user_id=user_id, definition_id=definition.id, auth_kind="api_key", status="ready"
    )
    await accounts_store.set_account_credentials(
        db,
        account_id=account.id,
        credential_ciphertext=encrypt_json({"secretFields": {"api_key": "s"}}),
        credential_format="secret-fields-v1",
        auth_status="ready",
        token_expires_at=None,
    )


async def _store_workflow(db: AsyncSession, owner: User, definition: dict, *, name: str):
    canonical, _specs = parse_definition(definition, require_steps=False)
    workflow, _version = await store.create_workflow_with_version(
        db,
        owner_user_id=owner.id,
        created_by_user_id=owner.id,
        name=name,
        description=None,
        definition_json=canonical,
    )
    return workflow


# --- no credential mint at StartRun (WF-ID) -----------------------------------


async def test_startrun_with_empty_scope_mints_no_gateway_token(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    wf = await _store_workflow(db_session, user, _definition(), name="no-integrations")
    run = await compiler.start_run(
        db_session,
        user,
        wf.id,
        inputs={},
        target_mode=WORKFLOW_TARGET_MODE_LOCAL,
        target_workspace_id=uuid.uuid4(),
    )
    assert "gateway" not in run.resolved_plan_json
    assert not hasattr(run, "private_envelope_json")
    tokens = (
        (
            await db_session.execute(
                store.select(WorkflowRunGatewayToken).where(
                    WorkflowRunGatewayToken.workflow_run_id == run.id
                )
            )
        )
        .scalars()
        .all()
    )
    assert tokens == []


async def test_startrun_validates_declared_scope_without_mint(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    await _seed_ready_account(db_session, user_id=user.id, namespace="context7")
    wf = await _store_workflow(
        db_session, user, _definition(integrations=["context7"]), name="scoped"
    )
    run = await compiler.start_run(
        db_session,
        user,
        wf.id,
        inputs={},
        target_mode=WORKFLOW_TARGET_MODE_LOCAL,
        target_workspace_id=uuid.uuid4(),
    )
    assert "gateway" not in run.resolved_plan_json
    assert not hasattr(run, "private_envelope_json")
    tokens = (
        (
            await db_session.execute(
                store.select(WorkflowRunGatewayToken).where(
                    WorkflowRunGatewayToken.workflow_run_id == run.id
                )
            )
        )
        .scalars()
        .all()
    )
    assert tokens == []


# --- per-slot integration narrowing (track 3c phase 2) -------------------------


async def test_resolve_run_scope_narrows_one_slot_leaves_others_default() -> None:
    from proliferate.server.cloud.workflows.gateway_grants import resolve_run_scope

    definition = {
        "version": 1,
        "inputs": [],
        "integrations": ["linear", "slack"],
        "agents": [
            {
                "slot": "triage",
                "harness": "claude",
                "model": "sonnet",
                "steps": [{"kind": "agent.prompt", "prompt": "hi"}],
                "integrations": ["linear"],
            },
            {
                "slot": "fix",
                "harness": "claude",
                "model": "sonnet",
                "steps": [{"kind": "agent.prompt", "prompt": "hi"}],
            },
        ],
    }
    scope = resolve_run_scope(definition)
    # Narrowed slot excludes the non-listed namespace (deny-path b).
    assert scope["triage"] == {"integrations": ["linear"]}
    # Unnarrowed slot keeps the full workflow-level list (deny-path c).
    assert scope["fix"] == {"integrations": ["linear", "slack"]}


async def test_resolve_run_scope_empty_narrowing_grants_nothing_to_that_slot() -> None:
    from proliferate.server.cloud.workflows.gateway_grants import resolve_run_scope

    definition = {
        "version": 1,
        "inputs": [],
        "integrations": ["linear"],
        "agents": [
            {
                "slot": "quiet",
                "harness": "claude",
                "model": "sonnet",
                "steps": [{"kind": "agent.prompt", "prompt": "hi"}],
                "integrations": [],
            },
        ],
    }
    assert resolve_run_scope(definition) == {"quiet": {"integrations": []}}


async def test_narrowed_scope_is_validated_without_token_mint(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    await _seed_ready_account(db_session, user_id=user.id, namespace="context7")
    definition = {
        "version": 1,
        "inputs": [],
        "integrations": ["context7"],
        "agents": [
            {
                "slot": "quiet",
                "harness": "claude",
                "model": "sonnet",
                "steps": [{"kind": "agent.prompt", "prompt": "hi"}],
                "integrations": [],
            },
        ],
    }
    wf = await _store_workflow(db_session, user, definition, name="narrowed")
    run = await compiler.start_run(
        db_session,
        user,
        wf.id,
        inputs={},
        target_mode=WORKFLOW_TARGET_MODE_LOCAL,
        target_workspace_id=uuid.uuid4(),
    )
    assert not hasattr(run, "private_envelope_json")
    token_count = await db_session.scalar(
        select(func.count()).select_from(WorkflowRunGatewayToken)
    )
    assert token_count == 0


async def test_l22_fail_fast_provider_without_ready_account(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    await sync_seed_definitions(db_session)
    await db_session.flush()
    # 'context7' is a visible seed but the owner connected NO account for it.
    wf = await _store_workflow(
        db_session, user, _definition(integrations=["context7"]), name="fail-fast"
    )
    with pytest.raises(CloudApiError) as excinfo:
        await compiler.start_run(
            db_session,
            user,
            wf.id,
            inputs={},
            target_mode=WORKFLOW_TARGET_MODE_LOCAL,
            target_workspace_id=uuid.uuid4(),
        )
    assert excinfo.value.code == "workflow_function_provider_not_ready"
    # No dangling run and no token — failure is before the run row is created.
    runs = (
        (
            await db_session.execute(
                store.select(WorkflowRun).where(WorkflowRun.workflow_id == wf.id)
            )
        )
        .scalars()
        .all()
    )
    assert runs == []


async def _seed_worker_with_scope(
    db: AsyncSession, *, owner_user_id: uuid.UUID, scope_json: list[str] | None
) -> None:
    """Seed the independent per-worker policy used by gateway auth tests."""

    sandbox = CloudSandbox(
        owner_user_id=owner_user_id,
        sandbox_type="e2b",
        status="ready",
        purpose="interactive",
    )
    db.add(sandbox)
    await db.flush()
    worker = CloudRuntimeWorker(
        owner_user_id=owner_user_id,
        runtime_kind="cloud_sandbox",
        cloud_sandbox_id=sandbox.id,
        token_hash=uuid.uuid4().hex,
        status="online",
    )
    db.add(worker)
    await db.flush()
    db.add(
        CloudIntegrationGatewayToken(
            runtime_worker_id=worker.id,
            owner_user_id=owner_user_id,
            token_hash=uuid.uuid4().hex,
            status="active",
            scope_json=scope_json,
        )
    )
    await db.flush()


async def _seed_run_with_token(
    db: AsyncSession,
    *,
    owner: User,
    integrations: list[str],
    target_mode: str = WORKFLOW_TARGET_MODE_PERSONAL_CLOUD,
    status: str = "delivered",
) -> tuple[uuid.UUID, str]:
    """Seed tombstoned auth evidence directly; production has no mint builder."""

    workflow = await _store_workflow(
        db,
        owner,
        _definition(integrations=integrations),
        name=f"legacy-run-{uuid.uuid4().hex[:6]}",
    )
    assert workflow.current_version_id is not None
    run = await store.create_run(
        db,
        workflow_id=workflow.id,
        workflow_version_id=workflow.current_version_id,
        trigger_kind="manual",
        executor_user_id=owner.id,
        args_json={},
        target_mode=target_mode,
        resolved_plan_json={"steps": [], "sessions": {}},
    )
    if status != "pending_delivery":
        await store.update_run(db, run_id=run.id, status=status)
    plaintext = f"legacy-test-{uuid.uuid4().hex}"
    db.add(
        WorkflowRunGatewayToken(
            workflow_run_id=run.id,
            owner_user_id=owner.id,
            organization_id=None,
            token_hash=runtime_workers_store.hash_workflow_run_gateway_token(plaintext),
            scope_json=_scope_json(integrations),
            status="active",
            expires_at=utcnow() + timedelta(hours=24),
        )
    )
    await db.flush()
    return run.id, plaintext


# --- retired legacy bearer delivery path --------------------------------------


async def test_manually_seeded_legacy_ping_stops_at_feature_off_gate(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _make_user(db_session)
    run_id, plaintext = await _seed_run_with_token(
        db_session, owner=user, integrations=[], status="running"
    )
    await db_session.commit()
    before = await store.get_run(db_session, run_id)

    response = await client.post(
        f"/v1/cloud/workflows/runs/{run_id}/ping",
        headers={"Authorization": f"Bearer {plaintext}"},
    )

    assert response.status_code == 409
    after = await store.get_run(db_session, run_id)
    assert after.status == before.status
    assert after.updated_at == before.updated_at
# --- gateway scope: pure helpers (E3 namespace-level) --------------------------


async def test_scope_authorize_namespace_grants_all_tools() -> None:
    # E3: a namespace-only entry (no "tools" key) reaches every tool of the provider.
    run_scope = [{"provider": "context7"}]
    assert scope.authorize_tool_call(
        run_scope=run_scope, worker_scope=None, provider="context7", tool="a"
    ).allowed
    assert scope.authorize_tool_call(
        run_scope=run_scope, worker_scope=None, provider="context7", tool="anything_else"
    ).allowed
    denied_provider = scope.authorize_tool_call(
        run_scope=run_scope, worker_scope=None, provider="exa", tool="a"
    )
    assert denied_provider.reason == scope.SCOPE_DENY_PROVIDER_OUT_OF_RUN
    denied_worker = scope.authorize_tool_call(
        run_scope=run_scope, worker_scope=["exa"], provider="context7", tool="a"
    )
    assert denied_worker.reason == scope.SCOPE_DENY_PROVIDER_OUT_OF_WORKER


async def test_scope_filter_keeps_all_tools_of_a_granted_namespace() -> None:
    run_scope = [{"provider": "context7"}]
    tools = [{"name": "a"}, {"name": "b"}, {"noname": 1}]
    filtered = scope.filter_tools_to_scope(
        run_scope=run_scope, worker_scope=None, provider="context7", tools=tools
    )
    # Every named tool of the granted namespace survives (unnamed dropped).
    assert filtered == [{"name": "a"}, {"name": "b"}]
    # Namespace-level worker intersection.
    assert scope.intersect_namespaces_with_worker(["context7", "exa"], None) == [
        "context7",
        "exa",
    ]
    assert scope.intersect_namespaces_with_worker(["context7", "exa"], ["exa"]) == ["exa"]
    assert scope.intersect_namespaces_with_worker(["context7"], []) == []


# --- gateway scope: dependency resolution --------------------------------------


@dataclass
class _FakeRequest:
    headers: dict


async def test_dependency_resolves_run_token_first_and_rechecks_worker(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    await _seed_worker_with_scope(db_session, owner_user_id=user.id, scope_json=["context7"])
    run_id, plaintext = await _seed_run_with_token(
        db_session, owner=user, integrations=["context7"]
    )

    request = _FakeRequest(headers={"authorization": f"Bearer {plaintext}"})
    grant = await gateway_deps.require_integration_gateway_grant(request, db_session)
    assert grant.run_id == run_id
    # E3: the per-slot scope_json flattens to namespace-only run-scope entries.
    assert grant.run_scope == [{"provider": "context7"}]
    assert grant.worker_scope == ["context7"]

    # Narrow the worker allowlist AFTER mint -> the next resolution reflects it.
    token = (
        await db_session.execute(
            store.select(CloudIntegrationGatewayToken).where(
                CloudIntegrationGatewayToken.owner_user_id == user.id
            )
        )
    ).scalar_one()
    token.scope_json = ["exa"]
    await db_session.flush()
    grant2 = await gateway_deps.require_integration_gateway_grant(request, db_session)
    assert grant2.worker_scope == ["exa"]
    assert not scope.authorize_tool_call(
        run_scope=grant2.run_scope,
        worker_scope=grant2.worker_scope,
        provider="context7",
        tool="a",
    ).allowed


async def test_dependency_worker_token_path_regression_free(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    sandbox = CloudSandbox(
        owner_user_id=user.id, sandbox_type="e2b", status="ready", purpose="interactive"
    )
    db_session.add(sandbox)
    await db_session.flush()
    worker = CloudRuntimeWorker(
        owner_user_id=user.id,
        runtime_kind="cloud_sandbox",
        cloud_sandbox_id=sandbox.id,
        token_hash=uuid.uuid4().hex,
        status="online",
    )
    db_session.add(worker)
    await db_session.flush()
    worker_token = f"wt-{uuid.uuid4().hex}"
    db_session.add(
        CloudIntegrationGatewayToken(
            runtime_worker_id=worker.id,
            owner_user_id=user.id,
            token_hash=runtime_workers_store.hash_gateway_token(worker_token),
            status="active",
            scope_json=None,
        )
    )
    await db_session.flush()

    request = _FakeRequest(headers={"authorization": f"Bearer {worker_token}"})
    grant = await gateway_deps.require_integration_gateway_grant(request, db_session)
    assert grant.run_id is None  # per-worker grant
    assert grant.run_scope is None  # no per-run restriction
    assert grant.worker_scope is None  # unscoped, today's behavior


# --- gateway scope: service enforcement ----------------------------------------


async def test_call_provider_tool_out_of_scope_is_enumerated_error(
    db_session: AsyncSession,
) -> None:
    # A provider NOT granted to the run is denied (namespace not in run scope).
    grant = runtime_workers_store.IntegrationGatewayGrant(
        owner_user_id=uuid.uuid4(),
        organization_id=None,
        run_id=uuid.uuid4(),
        run_scope=[{"provider": "context7"}],
        worker_scope=None,
    )
    with pytest.raises(CloudApiError) as excinfo:
        await gateway_service.call_provider_tool(
            db_session, grant=grant, provider="exa", tool="danger", arguments={}
        )
    assert excinfo.value.code == "integration_gateway_scope_denied"


async def test_list_tools_returns_all_tools_of_granted_namespace(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    @dataclass
    class _Pair:
        account: object
        definition: object

    async def _fake_account_for_provider(db, *, grant, provider):  # type: ignore[no-untyped-def]
        return _Pair(account=object(), definition=object())

    async def _fake_tool_cache(db, *, account_record, definition_record):  # type: ignore[no-untyped-def]
        return [{"name": "a"}, {"name": "b"}]

    monkeypatch.setattr(gateway_service, "account_for_provider", _fake_account_for_provider)
    monkeypatch.setattr(gateway_service, "get_or_refresh_tool_cache", _fake_tool_cache)

    grant = runtime_workers_store.IntegrationGatewayGrant(
        owner_user_id=uuid.uuid4(),
        organization_id=None,
        run_id=uuid.uuid4(),
        run_scope=[{"provider": "context7"}],
        worker_scope=None,
    )
    result = await gateway_service.list_tools_for_provider(
        db_session, grant=grant, provider="context7"
    )
    # E3: a namespace grant exposes every tool of the provider.
    assert result["tools"] == [{"name": "a"}, {"name": "b"}]


# --- ADDENDUM 1: org-policy enforcement in the gateway (regression guard) -------


async def _seed_ready_account_for_definition(
    db: AsyncSession, *, user_id: uuid.UUID, definition: CloudIntegrationDefinition
) -> None:
    account = await accounts_store.upsert_account(
        db, user_id=user_id, definition_id=definition.id, auth_kind="api_key", status="ready"
    )
    await accounts_store.set_account_credentials(
        db,
        account_id=account.id,
        credential_ciphertext=encrypt_json({"secretFields": {"api_key": "s"}}),
        credential_format="secret-fields-v1",
        auth_status="ready",
        token_expires_at=None,
    )


async def test_org_disabled_provider_filtered_from_ready_accounts(
    db_session: AsyncSession,
) -> None:
    """An org-policy-disabled provider is filtered out of the gateway's ready
    accounts (regression: this branch had dropped ``_org_allows`` filtering)."""
    user = await _make_user(db_session)
    await sync_seed_definitions(db_session)
    await db_session.flush()
    definition = await definitions_store.get_seed_by_namespace(db_session, "context7")
    assert definition is not None
    await _seed_ready_account_for_definition(db_session, user_id=user.id, definition=definition)

    org_id = await _make_org(db_session, user)

    # Without an org overlay the account is visible.
    open_grant = runtime_workers_store.IntegrationGatewayGrant(
        owner_user_id=user.id,
        organization_id=org_id,
        run_id=uuid.uuid4(),
        run_scope=None,
        worker_scope=None,
    )
    before = await gateway_service.ready_accounts_for_grant(db_session, grant=open_grant)
    assert any(pair.definition.namespace == "context7" for pair in before)

    # Disable the definition for this org: an explicit policy row with enabled=False.
    db_session.add(
        CloudIntegrationPolicy(
            organization_id=org_id,
            definition_id=definition.id,
            enabled=False,
            updated_by_user_id=user.id,
        )
    )
    await db_session.flush()

    after = await gateway_service.ready_accounts_for_grant(db_session, grant=open_grant)
    assert all(pair.definition.namespace != "context7" for pair in after)

    # The per-provider path is filtered too (list AND call agree).
    with pytest.raises(CloudApiError) as excinfo:
        await gateway_service.account_for_provider(
            db_session, grant=open_grant, provider="context7"
        )
    assert excinfo.value.code in {
        "integration_provider_not_found",
        "integration_provider_disabled",
    }


# --- L26 purpose stamping ------------------------------------------------------


async def test_purpose_stamped_workflow_run_on_create(db_session: AsyncSession) -> None:
    from proliferate.db.store import cloud_sandboxes as sandbox_store

    user = await _make_user(db_session)
    created = await sandbox_store.ensure_personal_cloud_sandbox(
        db_session,
        user_id=user.id,
        created_by_user_id=user.id,
        billing_subject_id=uuid.uuid4(),
        e2b_template_ref="e2b",
        purpose="workflow-run",
    )
    assert created.purpose == "workflow-run"
    # Re-ensure never restamps (L26: stamped once at creation).
    again = await sandbox_store.ensure_personal_cloud_sandbox(
        db_session,
        user_id=user.id,
        created_by_user_id=user.id,
        billing_subject_id=uuid.uuid4(),
        e2b_template_ref="e2b",
        purpose="interactive",
    )
    assert again.purpose == "workflow-run"


async def test_purpose_defaults_interactive_on_create(db_session: AsyncSession) -> None:
    from proliferate.db.store import cloud_sandboxes as sandbox_store

    user = await _make_user(db_session)
    created = await sandbox_store.ensure_personal_cloud_sandbox(
        db_session,
        user_id=user.id,
        created_by_user_id=user.id,
        billing_subject_id=uuid.uuid4(),
        e2b_template_ref="e2b",
    )
    assert created.purpose == "interactive"


# --- parked legacy report authentication --------------------------------------


class _StubRequest:
    """Minimal stand-in for a Starlette Request — ``_bearer_token`` only reads
    ``headers.get``."""

    def __init__(self, authorization: str | None = None) -> None:
        self.headers = {} if authorization is None else {"authorization": authorization}


async def test_status_token_stops_at_feature_off_gate(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _make_user(db_session)
    run_id, plaintext = await _seed_run_with_token(db_session, owner=user, integrations=[])
    await db_session.commit()
    before = await store.get_run(db_session, run_id)

    resp = await client.post(
        f"/v1/cloud/workflows/runs/{run_id}/status",
        headers={"Authorization": f"Bearer {plaintext}"},
        json={"status": "running"},
    )
    assert resp.status_code == 409
    after = await store.get_run(db_session, run_id)
    assert after.status == before.status
    assert after.updated_at == before.updated_at


async def test_status_rejects_mismatched_run_token(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Run A's token cannot report on run B (spoofing → 403), mirroring /ping."""
    user = await _make_user(db_session)
    _run_a, token_a = await _seed_run_with_token(db_session, owner=user, integrations=[])
    run_b, _ = await _seed_run_with_token(db_session, owner=user, integrations=[])
    await db_session.commit()

    resp = await client.post(
        f"/v1/cloud/workflows/runs/{run_b}/status",
        headers={"Authorization": f"Bearer {token_a}"},
        json={"status": "running"},
    )
    assert resp.status_code == 403
    # Run B stayed put — a rejected report changes no state.
    after = await store.get_run(db_session, run_b)
    assert after.status == "delivered"


async def test_status_no_credential_unauthorized(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _make_user(db_session)
    run_id, _ = await _seed_run_with_token(db_session, owner=user, integrations=[])
    await db_session.commit()

    resp = await client.post(
        f"/v1/cloud/workflows/runs/{run_id}/status",
        json={"status": "running"},
    )
    assert resp.status_code == 401


async def test_authorize_run_report_accepts_user_session(db_session: AsyncSession) -> None:
    """The desktop local-lane relay reports on a user session (no bearer) — the
    resolver returns the user unchanged."""
    from proliferate.server.cloud.workflows.access import authorize_run_report

    user = await _make_user(db_session)
    run_id, _ = await _seed_run_with_token(db_session, owner=user, integrations=[])

    actor = await authorize_run_report(
        run_id=run_id, request=_StubRequest(), db=db_session, user=user
    )
    assert actor is user


async def test_authorize_run_report_prefers_run_token(db_session: AsyncSession) -> None:
    """A valid run token authenticates as the runtime even when no user is present."""
    from proliferate.server.cloud.workflows.access import RunTokenActor, authorize_run_report

    user = await _make_user(db_session)
    run_id, plaintext = await _seed_run_with_token(db_session, owner=user, integrations=[])

    actor = await authorize_run_report(
        run_id=run_id,
        request=_StubRequest(f"Bearer {plaintext}"),
        db=db_session,
        user=None,
    )
    assert isinstance(actor, RunTokenActor)
    assert actor.id == user.id


async def test_delivered_token_stops_at_feature_off_gate(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _make_user(db_session)
    run_id, plaintext = await _seed_run_with_token(
        db_session, owner=user, integrations=[], status="pending_delivery"
    )
    await db_session.commit()

    resp = await client.post(
        f"/v1/cloud/workflows/runs/{run_id}/delivered",
        headers={"Authorization": f"Bearer {plaintext}"},
    )
    assert resp.status_code == 409
    after = await store.get_run(db_session, run_id)
    assert after.status == "pending_delivery"


# --- Track 1b Phase 1: gateway CHAT default-access modes (§2) -------------------
#
# Tier-1 DENY-PATH floor. A per-worker (chat/interactive) grant is subject to the
# org's configurable default-access policy, wired from
# ``CloudIntegrationPolicy.scope_json``. Asserted AT THE GATEWAY (list_providers
# absence + call_provider_tool 403), never on prose. Workflows (run-token grants)
# are unaffected: they carry their own frozen run_scope.


async def _seed_org_worker_token(
    db: AsyncSession, *, owner_user_id: uuid.UUID, organization_id: uuid.UUID
) -> str:
    """A per-worker (chat) gateway token for an org-scoped worker; returns the bearer."""
    sandbox = CloudSandbox(
        owner_user_id=owner_user_id,
        sandbox_type="e2b",
        status="ready",
        purpose="interactive",
    )
    db.add(sandbox)
    await db.flush()
    worker = CloudRuntimeWorker(
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        runtime_kind="cloud_sandbox",
        cloud_sandbox_id=sandbox.id,
        token_hash=uuid.uuid4().hex,
        status="online",
    )
    db.add(worker)
    await db.flush()
    token = f"wt-{uuid.uuid4().hex}"
    db.add(
        CloudIntegrationGatewayToken(
            runtime_worker_id=worker.id,
            owner_user_id=owner_user_id,
            token_hash=runtime_workers_store.hash_gateway_token(token),
            status="active",
            scope_json=None,
        )
    )
    await db.flush()
    return token


async def _set_chat_default_scope(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    definition_id: uuid.UUID,
    scope_json: list[str] | None,
    updated_by: uuid.UUID,
) -> None:
    db.add(
        CloudIntegrationPolicy(
            organization_id=organization_id,
            definition_id=definition_id,
            enabled=True,
            scope_json=scope_json,
            updated_by_user_id=updated_by,
        )
    )
    await db.flush()


async def _chat_grant(db: AsyncSession, *, token: str) -> object:
    request = _FakeRequest(headers={"authorization": f"Bearer {token}"})
    return await gateway_deps.require_integration_gateway_grant(request, db)


async def test_chat_default_all_when_no_policy_restriction(
    db_session: AsyncSession,
) -> None:
    """default-all: an org that authored NO scope_json restriction gets every ready
    integration in the chat default set (today's unconditional behavior)."""
    user = await _make_user(db_session)
    org_id = await _make_org(db_session, user)
    await sync_seed_definitions(db_session)
    await db_session.flush()
    for ns in ("context7", "exa"):
        definition = await definitions_store.get_seed_by_namespace(db_session, ns)
        assert definition is not None
        await _seed_ready_account_for_definition(
            db_session, user_id=user.id, definition=definition
        )

    token = await _seed_org_worker_token(db_session, owner_user_id=user.id, organization_id=org_id)
    grant = await _chat_grant(db_session, token=token)
    assert grant.default_scope is None  # unscoped -> default-all
    providers = await gateway_service.list_providers(db_session, grant=grant)
    names = {p["provider"] for p in providers["providers"]}
    assert {"context7", "exa"} <= names


async def test_chat_default_subset_hides_excluded_and_denies_forced_call(
    db_session: AsyncSession,
) -> None:
    """default-subset: an org excludes one integration (scope_json=[]). The chat
    session neither SEES it in list_providers nor can force a call (403), while a
    peer integration with no restriction stays reachable."""
    user = await _make_user(db_session)
    org_id = await _make_org(db_session, user)
    await sync_seed_definitions(db_session)
    await db_session.flush()
    context7 = await definitions_store.get_seed_by_namespace(db_session, "context7")
    exa = await definitions_store.get_seed_by_namespace(db_session, "exa")
    assert context7 is not None and exa is not None
    for definition in (context7, exa):
        await _seed_ready_account_for_definition(
            db_session, user_id=user.id, definition=definition
        )

    # Exclude exa from the chat default set (scope_json=[]); context7 unrestricted.
    await _set_chat_default_scope(
        db_session,
        organization_id=org_id,
        definition_id=exa.id,
        scope_json=[],
        updated_by=user.id,
    )
    token = await _seed_org_worker_token(db_session, owner_user_id=user.id, organization_id=org_id)
    grant = await _chat_grant(db_session, token=token)

    # ABSENCE: excluded provider is not in list_providers; the peer still is.
    providers = await gateway_service.list_providers(db_session, grant=grant)
    names = {p["provider"] for p in providers["providers"]}
    assert "exa" not in names
    assert "context7" in names

    # 403: a forced call to the excluded provider is scope-denied (no upstream call).
    with pytest.raises(CloudApiError) as excinfo:
        await gateway_service.call_provider_tool(
            db_session, grant=grant, provider="exa", tool="search", arguments={}
        )
    assert excinfo.value.code == "integration_gateway_scope_denied"


async def test_chat_default_per_integration_tool_restriction(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Per-integration default access mode: scope_json=["a"] keeps the integration in
    the default set but restricts it to tool ``a`` — ``b`` is scope-denied and hidden
    from tools/list."""
    user = await _make_user(db_session)
    org_id = await _make_org(db_session, user)
    await sync_seed_definitions(db_session)
    await db_session.flush()
    context7 = await definitions_store.get_seed_by_namespace(db_session, "context7")
    assert context7 is not None
    await _seed_ready_account_for_definition(db_session, user_id=user.id, definition=context7)
    await _set_chat_default_scope(
        db_session,
        organization_id=org_id,
        definition_id=context7.id,
        scope_json=["a"],
        updated_by=user.id,
    )
    token = await _seed_org_worker_token(db_session, owner_user_id=user.id, organization_id=org_id)
    grant = await _chat_grant(db_session, token=token)
    assert grant.default_scope == [{"provider": "context7", "tools": ["a"]}]

    async def _fake_tool_cache(db, *, account_record, definition_record):  # type: ignore[no-untyped-def]
        return [{"name": "a"}, {"name": "b"}]

    monkeypatch.setattr(gateway_service, "get_or_refresh_tool_cache", _fake_tool_cache)
    listed = await gateway_service.list_tools_for_provider(
        db_session, grant=grant, provider="context7"
    )
    assert listed["tools"] == [{"name": "a"}]

    with pytest.raises(CloudApiError) as excinfo:
        await gateway_service.call_provider_tool(
            db_session, grant=grant, provider="context7", tool="b", arguments={}
        )
    assert excinfo.value.code == "integration_gateway_scope_denied"


async def test_chat_default_policy_does_not_narrow_workflow_run_grant(
    db_session: AsyncSession,
) -> None:
    """Workflows unchanged (E3): a run-token grant carries its own frozen run_scope;
    the org's chat default-access policy never applies (effective_run_scope == the
    run's scope, and default_scope stays None)."""
    user = await _make_user(db_session)
    await _seed_worker_with_scope(
        db_session, owner_user_id=user.id, scope_json=["context7", "exa"]
    )
    run_id, plaintext = await _seed_run_with_token(
        db_session, owner=user, integrations=["context7"]
    )
    grant = await _chat_grant(db_session, token=plaintext)
    assert grant.run_id == run_id
    assert grant.default_scope is None
    assert grant.effective_run_scope == [{"provider": "context7"}]
