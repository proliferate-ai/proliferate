"""WS3b credential-audience token + per-slot issuance-handle persistence (§5.3).

Mechanical store operations over the WS3b surface of
``cloud_workflow_run_gateway_token`` (typed audiences + session-bound integration
binding) and ``workflow_credential_issuance`` (per-slot one-use handles). No
policy lives here — the exchange/ACK/rotation sequencing is the caller's
(``workflows.credential_exchange``). Secrets never enter these rows: tokens store
only the HMAC hash, handles only the handle hash.

The legacy all-purpose run-token mint path (``cloud_workflows.create_run_gateway_token``
/ ``get_active_run_gateway_token_by_hash``) is intentionally left untouched so
pre-WS3b runs keep working (audience NULL); this module adds the audience-aware
lookup + writes the new-style tokens and handles alongside it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import (
    WORKFLOW_ISSUANCE_STATUS_ACKNOWLEDGED,
    WORKFLOW_ISSUANCE_STATUS_EXCHANGED,
    WORKFLOW_ISSUANCE_STATUS_PENDING,
    WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_ACTIVE,
    WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_REVOKED,
)
from proliferate.db.models.cloud.workflow_gateway_models import (
    WorkflowCredentialIssuance,
    WorkflowRunGatewayToken,
)
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class AudienceTokenRecord:
    """A run gateway token with its WS3b audience + session-bound binding.

    ``audience is None`` means a LEGACY all-purpose run token (pre-WS3b) that the
    verification helpers accept on every endpoint family for compatibility.
    """

    id: UUID
    workflow_run_id: UUID
    owner_user_id: UUID
    organization_id: UUID | None
    scope_json: object
    status: str
    audience: str | None
    slot_id: str | None
    session_id: str | None
    generation: int | None
    issuance_id: UUID | None
    expires_at: datetime


@dataclass(frozen=True)
class IssuanceRecord:
    id: UUID
    workflow_run_id: UUID
    slot_id: str
    plan_hash: str | None
    session_id: str | None
    generation: int
    status: str
    integration_token_id: UUID | None


def _token_record(row: WorkflowRunGatewayToken) -> AudienceTokenRecord:
    return AudienceTokenRecord(
        id=row.id,
        workflow_run_id=row.workflow_run_id,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        scope_json=row.scope_json,
        status=row.status,
        audience=row.audience,
        slot_id=row.slot_id,
        session_id=row.session_id,
        generation=row.generation,
        issuance_id=row.issuance_id,
        expires_at=row.expires_at,
    )


def _issuance_record(row: WorkflowCredentialIssuance) -> IssuanceRecord:
    return IssuanceRecord(
        id=row.id,
        workflow_run_id=row.workflow_run_id,
        slot_id=row.slot_id,
        plan_hash=row.plan_hash,
        session_id=row.session_id,
        generation=row.generation,
        status=row.status,
        integration_token_id=row.integration_token_id,
    )


# --- audience tokens -----------------------------------------------------------


async def create_audience_token(
    db: AsyncSession,
    *,
    workflow_run_id: UUID,
    owner_user_id: UUID,
    organization_id: UUID | None,
    token_hash: str,
    scope_json: object,
    audience: str,
    expires_at: datetime,
    slot_id: str | None = None,
    session_id: str | None = None,
    generation: int | None = None,
    issuance_id: UUID | None = None,
) -> AudienceTokenRecord:
    """Insert one new-style (audience-stamped) run gateway token."""

    now = utcnow()
    row = WorkflowRunGatewayToken(
        id=uuid4(),
        workflow_run_id=workflow_run_id,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        token_hash=token_hash,
        scope_json=scope_json,
        status=WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_ACTIVE,
        audience=audience,
        slot_id=slot_id,
        session_id=session_id,
        generation=generation,
        issuance_id=issuance_id,
        expires_at=expires_at,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    return _token_record(row)


async def get_audience_token_by_hash(
    db: AsyncSession, *, token_hash: str, now: datetime
) -> AudienceTokenRecord | None:
    """An active, unexpired run gateway token by hash — WITH its audience/binding.

    The audience-aware replacement for ``cloud_workflows.get_active_run_gateway_token_by_hash``
    used by the endpoint auth deps: it returns the token's ``audience`` (NULL for a
    legacy all-purpose token) plus its trusted slot/session binding so a caller can
    reject a wrong-audience credential and inject trusted context.
    """

    row = (
        await db.execute(
            select(WorkflowRunGatewayToken).where(
                WorkflowRunGatewayToken.token_hash == token_hash,
                WorkflowRunGatewayToken.status == WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_ACTIVE,
                WorkflowRunGatewayToken.expires_at > now,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    row.last_used_at = now
    await db.flush()
    return _token_record(row)


async def get_token_by_id(db: AsyncSession, *, token_id: UUID) -> AudienceTokenRecord | None:
    row = await db.get(WorkflowRunGatewayToken, token_id)
    return None if row is None else _token_record(row)


async def rehash_audience_token(
    db: AsyncSession, *, token_id: UUID, token_hash: str
) -> AudienceTokenRecord | None:
    """Replace an active token's secret hash in place, keeping its generation.

    Used for the durable-before-response retry of an unacknowledged exchange: the
    (crashed) first secret is invalidated while the SAME generation is re-issued.
    """

    row = await db.get(WorkflowRunGatewayToken, token_id)
    if row is None:
        return None
    row.token_hash = token_hash
    row.updated_at = utcnow()
    await db.flush()
    return _token_record(row)


async def revoke_token_by_id(db: AsyncSession, *, token_id: UUID) -> None:
    row = await db.get(WorkflowRunGatewayToken, token_id)
    if row is not None and row.status == WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_ACTIVE:
        row.status = WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_REVOKED
        row.updated_at = utcnow()
        await db.flush()


async def revoke_superseded_integration_tokens(
    db: AsyncSession, *, issuance_id: UUID, keep_generation: int
) -> int:
    """Revoke a handle's active integration credentials below ``keep_generation``.

    The post-rotation-ACK step: once the runtime installs the newest generation,
    the bounded overlap closes and every older active generation for the same
    issuance (delivery identity) is revoked. Returns the number revoked.
    """

    rows = (
        (
            await db.execute(
                select(WorkflowRunGatewayToken).where(
                    WorkflowRunGatewayToken.issuance_id == issuance_id,
                    WorkflowRunGatewayToken.status == WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_ACTIVE,
                    WorkflowRunGatewayToken.generation < keep_generation,
                )
            )
        )
        .scalars()
        .all()
    )
    now = utcnow()
    for row in rows:
        row.status = WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_REVOKED
        row.updated_at = now
    if rows:
        await db.flush()
    return len(rows)


async def get_run_org_id(db: AsyncSession, *, workflow_run_id: UUID) -> UUID | None:
    """The organization id frozen on the run's active gateway tokens, if any."""

    row = (
        await db.execute(
            select(WorkflowRunGatewayToken.organization_id).where(
                WorkflowRunGatewayToken.workflow_run_id == workflow_run_id,
                WorkflowRunGatewayToken.status == WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_ACTIVE,
            )
        )
    ).first()
    return None if row is None else row[0]


async def get_run_scope_map(
    db: AsyncSession, *, workflow_run_id: UUID
) -> dict[str, object] | None:
    """The run's frozen per-slot namespace grant (``{slot: {integrations: [...]}}``).

    Read from any of the run's active gateway tokens — they all carry the same
    per-slot scope map stamped at StartRun. Used to scope a session-bound
    integration credential to just its slot on exchange.
    """

    row = (
        await db.execute(
            select(WorkflowRunGatewayToken.scope_json).where(
                WorkflowRunGatewayToken.workflow_run_id == workflow_run_id,
                WorkflowRunGatewayToken.status == WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_ACTIVE,
            )
        )
    ).first()
    if row is None:
        return None
    scope = row[0]
    return scope if isinstance(scope, dict) else None


# --- per-slot issuance handles -------------------------------------------------


async def create_issuance_handle(
    db: AsyncSession,
    *,
    workflow_run_id: UUID,
    slot_id: str,
    handle_hash: str,
    plan_hash: str | None,
) -> IssuanceRecord:
    now = utcnow()
    row = WorkflowCredentialIssuance(
        id=uuid4(),
        workflow_run_id=workflow_run_id,
        slot_id=slot_id,
        handle_hash=handle_hash,
        plan_hash=plan_hash,
        session_id=None,
        generation=1,
        status=WORKFLOW_ISSUANCE_STATUS_PENDING,
        integration_token_id=None,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    return _issuance_record(row)


async def get_issuance_by_handle_hash(
    db: AsyncSession, *, workflow_run_id: UUID, handle_hash: str
) -> IssuanceRecord | None:
    row = (
        await db.execute(
            select(WorkflowCredentialIssuance).where(
                WorkflowCredentialIssuance.workflow_run_id == workflow_run_id,
                WorkflowCredentialIssuance.handle_hash == handle_hash,
            )
        )
    ).scalar_one_or_none()
    return None if row is None else _issuance_record(row)


async def get_issuance_by_id(db: AsyncSession, *, issuance_id: UUID) -> IssuanceRecord | None:
    row = await db.get(WorkflowCredentialIssuance, issuance_id)
    return None if row is None else _issuance_record(row)


async def bind_issuance_exchange(
    db: AsyncSession,
    *,
    issuance_id: UUID,
    session_id: str,
    integration_token_id: UUID,
    generation: int,
) -> IssuanceRecord | None:
    """Record the first exchange: bind the handle to a session + its credential."""

    row = await db.get(WorkflowCredentialIssuance, issuance_id)
    if row is None:
        return None
    row.session_id = session_id
    row.integration_token_id = integration_token_id
    row.generation = generation
    row.status = WORKFLOW_ISSUANCE_STATUS_EXCHANGED
    row.updated_at = utcnow()
    await db.flush()
    return _issuance_record(row)


async def set_issuance_generation(
    db: AsyncSession,
    *,
    issuance_id: UUID,
    integration_token_id: UUID,
    generation: int,
) -> IssuanceRecord | None:
    """Point the handle at a rotated credential generation (scope unchanged)."""

    row = await db.get(WorkflowCredentialIssuance, issuance_id)
    if row is None:
        return None
    row.integration_token_id = integration_token_id
    row.generation = generation
    row.updated_at = utcnow()
    await db.flush()
    return _issuance_record(row)


async def acknowledge_issuance(db: AsyncSession, *, issuance_id: UUID) -> IssuanceRecord | None:
    """Consume the handle after the runtime ACKs install (no further exchange)."""

    row = await db.get(WorkflowCredentialIssuance, issuance_id)
    if row is None:
        return None
    row.status = WORKFLOW_ISSUANCE_STATUS_ACKNOWLEDGED
    row.updated_at = utcnow()
    await db.flush()
    return _issuance_record(row)
