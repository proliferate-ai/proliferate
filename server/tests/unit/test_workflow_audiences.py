"""WS3b credential audiences + per-slot one-use issuance (feature spec §5.3/§7.1).

Tier-1 against a real DB (``db_session``): the audience-denial matrix across all
four endpoint families, per-slot handle exchange (durable-before-response,
identical-retry same-generation, post-ACK reuse denied, wrong-session denied),
rotation (bounded overlap, old generation revoked post-ACK, scope unchanged),
lease-gating (legacy-open until a lease exists), and trusted-context injection
(the credential — never agent-supplied arguments — carries run/slot/session).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import (
    WORKFLOW_TARGET_MODE_LOCAL,
)
from proliferate.db.models.auth import User
from proliferate.db.store import runtime_workers as runtime_workers_store
from proliferate.db.store import workflow_credentials as credentials_store
from proliferate.db.store.cloud_workflows import create_run_gateway_token
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.db.store.workflow_ledger import leases as leases_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integration_gateway import dependencies as gateway_deps
from proliferate.server.cloud.integrations.seeds import sync_seed_definitions
from proliferate.server.cloud.workflows import access, compiler
from proliferate.server.cloud.workflows.credential_exchange import (
    acknowledge_install,
    exchange_slot_credential,
    rotate_slot_credential,
)
from proliferate.server.cloud.workflows.domain.definition import parse_definition
from proliferate.db.store import cloud_workflows as store
from proliferate.utils.crypto import encrypt_json
from proliferate.utils.time import utcnow

pytestmark = pytest.mark.asyncio


@dataclass
class _FakeRequest:
    headers: dict


def _definition(*, integrations: list[str] | None = None) -> dict:
    return {
        "version": 1,
        "inputs": [],
        "integrations": integrations or [],
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
        email=f"aud-{uuid.uuid4().hex}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


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


async def _start_run(db: AsyncSession, user: User, *, integrations: list[str] | None = None):
    canonical, _specs = parse_definition(
        _definition(integrations=integrations), require_steps=False
    )
    workflow, _version = await store.create_workflow_with_version(
        db,
        owner_user_id=user.id,
        created_by_user_id=user.id,
        name=f"aud-{uuid.uuid4().hex[:6]}",
        description=None,
        definition_json=canonical,
    )
    return await compiler.start_run(
        db, user, workflow.id, inputs={}, target_mode=WORKFLOW_TARGET_MODE_LOCAL
    )


def _bearer(token: str) -> _FakeRequest:
    return _FakeRequest(headers={"authorization": f"Bearer {token}"})


def _tok(authorization: str) -> str:
    return authorization.split(" ", 1)[1]


async def _mint_legacy_token(db: AsyncSession, *, run_id: uuid.UUID, owner: User) -> str:
    """A pre-WS3b all-purpose token (audience NULL) for the same run."""
    plaintext = f"legacy-{uuid.uuid4().hex}"
    await create_run_gateway_token(
        db,
        workflow_run_id=run_id,
        owner_user_id=owner.id,
        organization_id=None,
        token_hash=runtime_workers_store.hash_workflow_run_gateway_token(plaintext),
        scope_json={"main": {"integrations": []}},
        expires_at=utcnow() + timedelta(hours=24),
    )
    return plaintext


# --- audience denial matrix ----------------------------------------------------


async def test_wrong_audience_denied_on_every_endpoint_family(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    await _seed_ready_account(db_session, user_id=user.id, namespace="context7")
    run = await _start_run(db_session, user, integrations=["context7"])
    creds = run.private_envelope_json["credentials"]
    run_report = _tok(creds["run_report"]["authorization"])
    ping = _tok(creds["ping"]["authorization"])
    delivery = _tok(creds["delivery_claim"]["authorization"])
    handle = creds["slot_issuance_handles"]["main"]
    issued = await exchange_slot_credential(
        db_session, run_id=run.id, owner_user_id=user.id, handle=handle, session_id="s1"
    )
    integration = _tok(issued.authorization)

    async def gateway_ok(token: str) -> bool:
        grant = await gateway_deps.require_integration_gateway_grant(_bearer(token), db_session)
        return grant.run_id == run.id

    async def report_ok(token: str) -> bool:
        actor = await access.authorize_run_report(run.id, _bearer(token), db_session, None)
        return isinstance(actor, access.RunTokenActor)

    async def ping_ok(token: str) -> bool:
        actor = await access.authorize_run_ping(run.id, _bearer(token), db_session)
        return isinstance(actor, access.RunTokenActor)

    async def delivery_ok(token: str) -> bool:
        actor = await access.authorize_delivery_claim(run.id, _bearer(token), db_session, None)
        return isinstance(actor, access.RunTokenActor)

    families = {
        "integration": (gateway_ok, integration),
        "run_report": (report_ok, run_report),
        "ping": (ping_ok, ping),
        "delivery_claim": (delivery_ok, delivery),
    }
    tokens = {
        "integration": integration,
        "run_report": run_report,
        "ping": ping,
        "delivery_claim": delivery,
    }
    for family, (checker, correct) in families.items():
        # Correct audience passes.
        assert await checker(correct) is True
        # Every other audience is denied (403).
        for other_name, other_token in tokens.items():
            if other_name == family:
                continue
            with pytest.raises(CloudApiError) as exc:
                await checker(other_token)
            assert exc.value.status_code == 403


async def test_legacy_token_passes_every_family(db_session: AsyncSession) -> None:
    """Compat pin: a pre-WS3b all-purpose token (audience NULL) authenticates on
    every endpoint family exactly as it did before migration."""
    user = await _make_user(db_session)
    run = await _start_run(db_session, user, integrations=[])
    legacy = await _mint_legacy_token(db_session, run_id=run.id, owner=user)

    grant = await gateway_deps.require_integration_gateway_grant(_bearer(legacy), db_session)
    assert grant.run_id == run.id
    assert isinstance(
        await access.authorize_run_report(run.id, _bearer(legacy), db_session, None),
        access.RunTokenActor,
    )
    assert isinstance(
        await access.authorize_run_ping(run.id, _bearer(legacy), db_session),
        access.RunTokenActor,
    )
    assert isinstance(
        await access.authorize_delivery_claim(run.id, _bearer(legacy), db_session, None),
        access.RunTokenActor,
    )


# --- handle exchange -----------------------------------------------------------


async def test_exchange_durable_before_response_and_identical_retry(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    await _seed_ready_account(db_session, user_id=user.id, namespace="context7")
    run = await _start_run(db_session, user, integrations=["context7"])
    handle = run.private_envelope_json["credentials"]["slot_issuance_handles"]["main"]

    first = await exchange_slot_credential(
        db_session, run_id=run.id, owner_user_id=user.id, handle=handle, session_id="s1"
    )
    assert first.generation == 1
    # Durable-before-response: the issuance row is persisted 'exchanged' before the
    # response is composed, so a crash-and-retry (re-call) reuses the SAME row.
    issuance = await credentials_store.get_issuance_by_handle_hash(
        db_session,
        workflow_run_id=run.id,
        handle_hash=runtime_workers_store.hash_workflow_issuance_handle(handle),
    )
    assert issuance is not None and issuance.status == "exchanged"

    # Identical unacknowledged retry for the same (handle, session) -> same generation.
    retry = await exchange_slot_credential(
        db_session, run_id=run.id, owner_user_id=user.id, handle=handle, session_id="s1"
    )
    assert retry.generation == 1


async def test_exchange_wrong_session_denied(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    run = await _start_run(db_session, user, integrations=[])
    handle = run.private_envelope_json["credentials"]["slot_issuance_handles"]["main"]

    await exchange_slot_credential(
        db_session, run_id=run.id, owner_user_id=user.id, handle=handle, session_id="s1"
    )
    with pytest.raises(CloudApiError) as exc:
        await exchange_slot_credential(
            db_session, run_id=run.id, owner_user_id=user.id, handle=handle, session_id="s2"
        )
    assert exc.value.status_code == 409
    assert exc.value.code == "workflow_credential_wrong_session"


async def test_exchange_post_ack_reuse_denied(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    run = await _start_run(db_session, user, integrations=[])
    handle = run.private_envelope_json["credentials"]["slot_issuance_handles"]["main"]

    await exchange_slot_credential(
        db_session, run_id=run.id, owner_user_id=user.id, handle=handle, session_id="s1"
    )
    await acknowledge_install(db_session, run_id=run.id, handle=handle, session_id="s1")
    with pytest.raises(CloudApiError) as exc:
        await exchange_slot_credential(
            db_session, run_id=run.id, owner_user_id=user.id, handle=handle, session_id="s1"
        )
    assert exc.value.status_code == 409
    assert exc.value.code == "workflow_credential_handle_consumed"


# --- lease gating (legacy-open until a lease exists) ---------------------------


async def test_exchange_lease_gate_activates_when_lease_exists(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    run = await _start_run(db_session, user, integrations=[])
    handle = run.private_envelope_json["credentials"]["slot_issuance_handles"]["main"]

    # A reserved (not prepared/claimed) lease -> the gate denies the exchange.
    acquired = await leases_store.acquire_session_leases(
        db_session, run_id=run.id, sessions=(("s1", "main"),)
    )
    assert acquired is not None
    with pytest.raises(CloudApiError) as exc:
        await exchange_slot_credential(
            db_session, run_id=run.id, owner_user_id=user.id, handle=handle, session_id="s1"
        )
    assert exc.value.code == "workflow_credential_lease_not_ready"

    # Once prepared, the exchange proceeds.
    await leases_store.transition_session_lease(
        db_session, lease_id=acquired[0].id, state="prepared"
    )
    issued = await exchange_slot_credential(
        db_session, run_id=run.id, owner_user_id=user.id, handle=handle, session_id="s1"
    )
    assert issued.generation == 1


# --- rotation ------------------------------------------------------------------


async def test_rotation_overlap_then_old_revoked_post_ack_scope_unchanged(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    await _seed_ready_account(db_session, user_id=user.id, namespace="context7")
    run = await _start_run(db_session, user, integrations=["context7"])
    handle = run.private_envelope_json["credentials"]["slot_issuance_handles"]["main"]

    gen1 = await exchange_slot_credential(
        db_session, run_id=run.id, owner_user_id=user.id, handle=handle, session_id="s1"
    )
    await acknowledge_install(db_session, run_id=run.id, handle=handle, session_id="s1")
    t1 = _tok(gen1.authorization)

    async def gateway_scope(token: str) -> list[dict]:
        grant = await gateway_deps.require_integration_gateway_grant(_bearer(token), db_session)
        return grant.run_scope

    scope_before = await gateway_scope(t1)

    gen2 = await rotate_slot_credential(
        db_session, run_id=run.id, owner_user_id=user.id, presented_token=t1, generation=1
    )
    assert gen2.generation == 2
    t2 = _tok(gen2.authorization)

    # Bounded overlap: BOTH generations authenticate before the ACK.
    assert await gateway_scope(t1) == scope_before
    scope_after = await gateway_scope(t2)
    assert scope_after == scope_before  # scope immutable across rotation

    # After the runtime ACKs the new generation, the old one is revoked.
    await acknowledge_install(db_session, run_id=run.id, handle=handle, session_id="s1")
    with pytest.raises(CloudApiError):
        await gateway_scope(t1)
    assert await gateway_scope(t2) == scope_before  # new generation still active


async def test_rotation_stale_generation_denied(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    await _seed_ready_account(db_session, user_id=user.id, namespace="context7")
    run = await _start_run(db_session, user, integrations=["context7"])
    handle = run.private_envelope_json["credentials"]["slot_issuance_handles"]["main"]
    gen1 = await exchange_slot_credential(
        db_session, run_id=run.id, owner_user_id=user.id, handle=handle, session_id="s1"
    )
    with pytest.raises(CloudApiError) as exc:
        await rotate_slot_credential(
            db_session,
            run_id=run.id,
            owner_user_id=user.id,
            presented_token=_tok(gen1.authorization),
            generation=7,  # not the current generation
        )
    assert exc.value.code == "workflow_credential_rotate_stale"


# --- trusted context injection -------------------------------------------------


async def test_integration_credential_carries_trusted_context_not_args(
    db_session: AsyncSession,
) -> None:
    """The gateway derives run/slot/session ONLY from the credential row; a
    session-bound integration credential is scoped to its slot's grant, so a
    provider outside that slot is denied regardless of any agent-supplied args."""
    user = await _make_user(db_session)
    await _seed_ready_account(db_session, user_id=user.id, namespace="context7")
    run = await _start_run(db_session, user, integrations=["context7"])
    handle = run.private_envelope_json["credentials"]["slot_issuance_handles"]["main"]
    issued = await exchange_slot_credential(
        db_session, run_id=run.id, owner_user_id=user.id, handle=handle, session_id="sess-xyz"
    )

    grant = await gateway_deps.require_integration_gateway_grant(
        _bearer(_tok(issued.authorization)), db_session
    )
    # Context comes from the token row, not from any tool argument.
    assert grant.run_id == run.id
    assert grant.slot_id == "main"
    assert grant.session_id == "sess-xyz"
    # The slot's grant is exactly its own namespaces.
    assert grant.run_scope == [{"provider": "context7"}]

    from proliferate.server.cloud.integration_gateway.domain import scope

    # In-scope provider allowed; an out-of-slot provider is denied even if the
    # agent were to name it in arguments (which are never read for context).
    assert scope.authorize_tool_call(
        run_scope=grant.run_scope, worker_scope=None, provider="context7", tool="x"
    ).allowed
    assert not scope.authorize_tool_call(
        run_scope=grant.run_scope, worker_scope=None, provider="slack", tool="x"
    ).allowed
