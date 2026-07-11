"""WS3b per-slot one-use integration-credential issuance (feature spec §5.3).

The runtime, after registering a session and acknowledging its lease, exchanges a
per-slot one-use handle (from the private envelope) over the authenticated control
channel for a short-lived integration credential bound to run / plan-hash /
generation / slot / session. This module owns that exchange/ACK/rotation policy;
``db.store.workflow_credentials`` owns the mechanical persistence and
``workflows.access`` owns the control-channel authentication.

Durability + idempotency guarantees (§5.3):

* the issuance result is persisted (flushed) BEFORE the response is composed, so a
  crash-and-retry reuses the same row rather than advancing;
* an identical retry for the same unacknowledged ``(handle, session)`` returns the
  SAME credential generation (the secret is re-minted so a lost first response is
  invalidated, but the generation — the contract-visible identity — is unchanged);
* a wrong-session exchange, a post-ACK reuse, or (where session leases exist) an
  exchange before the lease is prepared/claimed is denied;
* rotation mints the next generation with an UNCHANGED scope and a bounded overlap
  in which both generations authenticate, until the runtime ACKs and the older
  generation is revoked.

Lease gating is legacy-open: leases are not populated until WS7, so the exchange
requires a prepared/claimed lease ONLY when the run already has session leases;
a run with no lease rows is exchanged without a lease check (recorded below).
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import (
    WORKFLOW_CREDENTIAL_AUDIENCE_INTEGRATION,
    WORKFLOW_INTEGRATION_CREDENTIAL_TTL_SECONDS,
    WORKFLOW_ISSUANCE_STATUS_ACKNOWLEDGED,
    WORKFLOW_ISSUANCE_STATUS_EXCHANGED,
    WORKFLOW_ISSUANCE_STATUS_PENDING,
)
from proliferate.db.store import runtime_workers as runtime_workers_store
from proliferate.db.store import workflow_credentials as credentials_store
from proliferate.db.store.workflow_ledger import leases as leases_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.utils.time import utcnow

# Lease states in which a session is ready to receive its credential (§8.2).
_LEASE_READY_STATES = frozenset({"prepared", "claimed"})
_TOKEN_BYTES = 48


@dataclass(frozen=True)
class IssuedCredential:
    """The exchange/rotation result handed back over the control channel."""

    authorization: str
    audience: str
    generation: int
    slot_id: str
    session_id: str
    expires_at: str


async def _assert_lease_ready(db: AsyncSession, *, run_id: UUID, session_id: str) -> None:
    """Legacy-open lease gate (§5.3): require a prepared/claimed lease for the
    session ONLY when the run already has session leases (WS7+); a run with no
    lease rows is exchanged without a lease check."""

    leases = await leases_store.list_session_leases_for_run(db, run_id=run_id)
    if not leases:
        return  # legacy-open: leases are not populated until WS7.
    match = next((lease for lease in leases if lease.session_id == session_id), None)
    if match is None or match.state not in _LEASE_READY_STATES:
        raise CloudApiError(
            "workflow_credential_lease_not_ready",
            "The session lease is not prepared/claimed; cannot issue a credential.",
            status_code=409,
        )


async def _mint_integration_token(
    db: AsyncSession,
    *,
    run_id: UUID,
    owner_user_id: UUID,
    organization_id: UUID | None,
    slot_scope: dict[str, object],
    slot_id: str,
    session_id: str,
    generation: int,
    issuance_id: UUID,
) -> tuple[str, UUID]:
    plaintext = secrets.token_urlsafe(_TOKEN_BYTES)
    token = await credentials_store.create_audience_token(
        db,
        workflow_run_id=run_id,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        token_hash=runtime_workers_store.hash_workflow_run_gateway_token(plaintext),
        scope_json=slot_scope,
        audience=WORKFLOW_CREDENTIAL_AUDIENCE_INTEGRATION,
        expires_at=utcnow() + timedelta(seconds=WORKFLOW_INTEGRATION_CREDENTIAL_TTL_SECONDS),
        slot_id=slot_id,
        session_id=session_id,
        generation=generation,
        issuance_id=issuance_id,
    )
    return plaintext, token.id


def _result(plaintext: str, *, slot_id: str, session_id: str, generation: int) -> IssuedCredential:
    return IssuedCredential(
        authorization=f"Bearer {plaintext}",
        audience=WORKFLOW_CREDENTIAL_AUDIENCE_INTEGRATION,
        generation=generation,
        slot_id=slot_id,
        session_id=session_id,
        expires_at=(
            utcnow() + timedelta(seconds=WORKFLOW_INTEGRATION_CREDENTIAL_TTL_SECONDS)
        ).isoformat(),
    )


async def exchange_slot_credential(
    db: AsyncSession,
    *,
    run_id: UUID,
    owner_user_id: UUID,
    handle: str,
    session_id: str,
) -> IssuedCredential:
    """Exchange a one-use handle for a session-bound integration credential."""

    if not session_id:
        raise CloudApiError(
            "workflow_credential_missing_session",
            "A session_id is required to exchange a credential.",
            status_code=400,
        )
    issuance = await credentials_store.get_issuance_by_handle_hash(
        db,
        workflow_run_id=run_id,
        handle_hash=runtime_workers_store.hash_workflow_issuance_handle(handle),
    )
    if issuance is None:
        raise CloudApiError(
            "workflow_credential_handle_invalid",
            "Unknown or non-matching issuance handle.",
            status_code=404,
        )

    if issuance.status == WORKFLOW_ISSUANCE_STATUS_ACKNOWLEDGED:
        # Post-ACK reuse: the handle is consumed once the runtime installed it.
        raise CloudApiError(
            "workflow_credential_handle_consumed",
            "This issuance handle was already acknowledged and cannot be reused.",
            status_code=409,
        )

    if issuance.status == WORKFLOW_ISSUANCE_STATUS_EXCHANGED:
        # Already exchanged once. A different session is a spoofing attempt.
        if issuance.session_id != session_id:
            raise CloudApiError(
                "workflow_credential_wrong_session",
                "This handle is already bound to a different session.",
                status_code=409,
            )
        # Identical unacknowledged retry (e.g. a lost first response / crash): the
        # SAME generation is re-issued. Re-mint the secret so the lost first secret
        # is invalidated, keeping the contract-visible generation unchanged.
        await _assert_lease_ready(db, run_id=run_id, session_id=session_id)
        assert issuance.integration_token_id is not None
        plaintext = secrets.token_urlsafe(_TOKEN_BYTES)
        await credentials_store.rehash_audience_token(
            db,
            token_id=issuance.integration_token_id,
            token_hash=runtime_workers_store.hash_workflow_run_gateway_token(plaintext),
        )
        return _result(
            plaintext,
            slot_id=issuance.slot_id,
            session_id=session_id,
            generation=issuance.generation,
        )

    # First exchange (status pending).
    await _assert_lease_ready(db, run_id=run_id, session_id=session_id)
    organization_id = await credentials_store.get_run_org_id(db, workflow_run_id=run_id)
    scope_map = await credentials_store.get_run_scope_map(db, workflow_run_id=run_id) or {}
    slot_scope = scope_map.get(issuance.slot_id) or {"integrations": []}
    plaintext, token_id = await _mint_integration_token(
        db,
        run_id=run_id,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        slot_scope={issuance.slot_id: slot_scope},
        slot_id=issuance.slot_id,
        session_id=session_id,
        generation=1,
        issuance_id=issuance.id,
    )
    # Persist the issuance binding BEFORE responding (durable-before-response).
    await credentials_store.bind_issuance_exchange(
        db,
        issuance_id=issuance.id,
        session_id=session_id,
        integration_token_id=token_id,
        generation=1,
    )
    return _result(plaintext, slot_id=issuance.slot_id, session_id=session_id, generation=1)


async def acknowledge_install(
    db: AsyncSession,
    *,
    run_id: UUID,
    handle: str,
    session_id: str,
) -> None:
    """Consume the handle after the runtime installs its credential, and close any
    bounded rotation-overlap window by revoking superseded generations."""

    issuance = await credentials_store.get_issuance_by_handle_hash(
        db,
        workflow_run_id=run_id,
        handle_hash=runtime_workers_store.hash_workflow_issuance_handle(handle),
    )
    if issuance is None:
        raise CloudApiError(
            "workflow_credential_handle_invalid",
            "Unknown or non-matching issuance handle.",
            status_code=404,
        )
    if issuance.status == WORKFLOW_ISSUANCE_STATUS_PENDING:
        raise CloudApiError(
            "workflow_credential_not_exchanged",
            "Cannot acknowledge a handle that was never exchanged.",
            status_code=409,
        )
    if issuance.session_id != session_id:
        raise CloudApiError(
            "workflow_credential_wrong_session",
            "This handle is bound to a different session.",
            status_code=409,
        )
    await credentials_store.acknowledge_issuance(db, issuance_id=issuance.id)
    # Bounded overlap closes: revoke every older active generation for this handle.
    await credentials_store.revoke_superseded_integration_tokens(
        db, issuance_id=issuance.id, keep_generation=issuance.generation
    )


async def rotate_slot_credential(
    db: AsyncSession,
    *,
    run_id: UUID,
    owner_user_id: UUID,
    presented_token: str,
    generation: int,
) -> IssuedCredential:
    """Rotate a presented integration credential to its next generation (§5.3).

    Authenticated by the control channel; the presented integration credential +
    its generation identify what to rotate. The new generation is persisted and
    returned with an UNCHANGED scope; the old generation stays valid (bounded
    overlap) until the runtime ACKs install (:func:`acknowledge_install`).
    """

    token = await credentials_store.get_audience_token_by_hash(
        db,
        token_hash=runtime_workers_store.hash_workflow_run_gateway_token(presented_token),
        now=utcnow(),
    )
    if (
        token is None
        or token.audience != WORKFLOW_CREDENTIAL_AUDIENCE_INTEGRATION
        or token.workflow_run_id != run_id
        or token.issuance_id is None
    ):
        raise CloudApiError(
            "workflow_credential_rotate_invalid",
            "The presented credential is not a rotatable integration credential for this run.",
            status_code=403,
        )
    if token.generation != generation:
        # Fencing: only the current generation may request the next one.
        raise CloudApiError(
            "workflow_credential_rotate_stale",
            "The presented credential generation is stale.",
            status_code=409,
        )
    next_generation = (token.generation or 1) + 1
    plaintext, new_token_id = await _mint_integration_token(
        db,
        run_id=run_id,
        owner_user_id=owner_user_id,
        organization_id=token.organization_id,
        # Scope is immutable across rotation — copy it verbatim.
        slot_scope=token.scope_json if isinstance(token.scope_json, dict) else {},
        slot_id=token.slot_id or "",
        session_id=token.session_id or "",
        generation=next_generation,
        issuance_id=token.issuance_id,
    )
    await credentials_store.set_issuance_generation(
        db,
        issuance_id=token.issuance_id,
        integration_token_id=new_token_id,
        generation=next_generation,
    )
    return _result(
        plaintext,
        slot_id=token.slot_id or "",
        session_id=token.session_id or "",
        generation=next_generation,
    )
