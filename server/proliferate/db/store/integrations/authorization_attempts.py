"""Read projections for integration authorization attempts.

Mutation arrives with the stage-and-swap slice. Keeping this store read-only
here makes the additive schema observable without enabling lifecycle behavior.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.integration_authorization import (
    CloudIntegrationAuthorizationAttempt,
)
from proliferate.db.models.integrations import CloudIntegrationAccount
from proliferate.db.store.integrations.accounts import (
    IntegrationAccountRecord,
)
from proliferate.db.store.integrations.accounts import (
    record_from_row as account_record_from_row,
)
from proliferate.lib.infra.time.wall_clock import utcnow

NONTERMINAL_ATTEMPT_STATUSES = frozenset({"active", "exchanging", "validating"})
TERMINAL_ATTEMPT_STATUSES = frozenset(
    {"succeeded", "failed", "cancelled", "expired", "superseded"}
)


def effective_scope_authority_matches(current: str | None, candidate: str | None) -> bool:
    """Compare OAuth authority as scope sets, without trusting malformed legacy data."""

    if current == candidate:
        return True
    if current is None or candidate is None:
        return False
    try:
        current_value = json.loads(current)
        candidate_value = json.loads(candidate)
    except (json.JSONDecodeError, TypeError):
        return False
    if not isinstance(current_value, list) or not isinstance(candidate_value, list):
        return False
    if not all(isinstance(scope, str) for scope in current_value + candidate_value):
        return False
    return set(current_value) == set(candidate_value)


@dataclass(frozen=True)
class IntegrationAuthorizationAttemptRecord:
    id: UUID
    owner_user_id: UUID
    definition_id: UUID
    account_id: UUID | None
    purpose: str
    method: str
    generation: int
    status: str
    starting_grant_version: int | None
    starting_credential_version: int | None
    definition_security_revision_id: UUID
    provider_client_id: UUID | None
    credential_audience: str
    settings_json: str
    requested_scopes_json: str
    effective_scopes_json: str | None
    staged_credential_ciphertext: str | None
    staged_credential_format: str | None
    failure_code: str | None
    expires_at: datetime
    closed_at: datetime | None
    created_at: datetime
    updated_at: datetime


def _record(row: CloudIntegrationAuthorizationAttempt) -> IntegrationAuthorizationAttemptRecord:
    return IntegrationAuthorizationAttemptRecord(
        id=row.id,
        owner_user_id=row.owner_user_id,
        definition_id=row.definition_id,
        account_id=row.account_id,
        purpose=row.purpose,
        method=row.method,
        generation=row.generation,
        status=row.status,
        starting_grant_version=row.starting_grant_version,
        starting_credential_version=row.starting_credential_version,
        definition_security_revision_id=row.definition_security_revision_id,
        provider_client_id=row.provider_client_id,
        credential_audience=row.credential_audience,
        settings_json=row.settings_json,
        requested_scopes_json=row.requested_scopes_json,
        effective_scopes_json=row.effective_scopes_json,
        staged_credential_ciphertext=row.staged_credential_ciphertext,
        staged_credential_format=row.staged_credential_format,
        failure_code=row.failure_code,
        expires_at=row.expires_at,
        closed_at=row.closed_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def get_authorization_attempt(
    db: AsyncSession,
    attempt_id: UUID,
) -> IntegrationAuthorizationAttemptRecord | None:
    row = await db.get(CloudIntegrationAuthorizationAttempt, attempt_id)
    return _record(row) if row is not None else None


async def get_latest_authorization_attempt(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    definition_id: UUID,
) -> IntegrationAuthorizationAttemptRecord | None:
    row = await db.scalar(
        select(CloudIntegrationAuthorizationAttempt)
        .where(
            CloudIntegrationAuthorizationAttempt.owner_user_id == owner_user_id,
            CloudIntegrationAuthorizationAttempt.definition_id == definition_id,
        )
        .order_by(CloudIntegrationAuthorizationAttempt.generation.desc())
        .limit(1)
    )
    return _record(row) if row is not None else None


async def list_latest_authorization_attempts_for_user(
    db: AsyncSession,
    owner_user_id: UUID,
) -> tuple[IntegrationAuthorizationAttemptRecord, ...]:
    rows = (
        await db.scalars(
            select(CloudIntegrationAuthorizationAttempt)
            .where(CloudIntegrationAuthorizationAttempt.owner_user_id == owner_user_id)
            .order_by(
                CloudIntegrationAuthorizationAttempt.definition_id,
                CloudIntegrationAuthorizationAttempt.generation.desc(),
            )
        )
    ).all()
    latest: dict[UUID, IntegrationAuthorizationAttemptRecord] = {}
    for row in rows:
        latest.setdefault(row.definition_id, _record(row))
    return tuple(latest.values())


async def acquire_authorization_attempt_lock(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    definition_id: UUID,
) -> None:
    """Serialize one user's attempt generations for one definition."""

    await db.execute(
        text(
            "SELECT pg_advisory_xact_lock(hashtextextended("
            "'integration-authorization-attempt:' || CAST(:owner AS text) || ':' || "
            "CAST(:definition AS text), 0))"
        ),
        {"owner": str(owner_user_id), "definition": str(definition_id)},
    )


def _terminalize(
    row: CloudIntegrationAuthorizationAttempt,
    *,
    status: str,
    failure_code: str | None,
    now: datetime,
) -> None:
    row.status = status
    row.failure_code = failure_code
    row.staged_credential_ciphertext = None
    row.staged_credential_format = None
    row.closed_at = now
    row.updated_at = now


async def create_authorization_attempt(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    definition_id: UUID,
    account_id: UUID | None,
    purpose: str,
    method: str,
    starting_grant_version: int | None,
    starting_credential_version: int | None,
    definition_security_revision_id: UUID,
    provider_client_id: UUID | None,
    credential_audience: str,
    settings_json: str,
    requested_scopes_json: str,
    effective_scopes_json: str | None,
    staged_credential_ciphertext: str | None,
    staged_credential_format: str | None,
    status: str,
    expires_at: datetime,
) -> IntegrationAuthorizationAttemptRecord:
    """Supersede prior work and create the next generation atomically."""

    await acquire_authorization_attempt_lock(
        db,
        owner_user_id=owner_user_id,
        definition_id=definition_id,
    )
    rows = list(
        (
            await db.scalars(
                select(CloudIntegrationAuthorizationAttempt)
                .where(
                    CloudIntegrationAuthorizationAttempt.owner_user_id == owner_user_id,
                    CloudIntegrationAuthorizationAttempt.definition_id == definition_id,
                )
                .order_by(CloudIntegrationAuthorizationAttempt.generation)
                .with_for_update()
            )
        ).all()
    )
    now = utcnow()
    for row in rows:
        if row.status in NONTERMINAL_ATTEMPT_STATUSES:
            _terminalize(
                row,
                status="superseded",
                failure_code="superseded",
                now=now,
            )
    created = CloudIntegrationAuthorizationAttempt(
        owner_user_id=owner_user_id,
        definition_id=definition_id,
        account_id=account_id,
        purpose=purpose,
        method=method,
        generation=(rows[-1].generation + 1 if rows else 1),
        status=status,
        starting_grant_version=starting_grant_version,
        starting_credential_version=starting_credential_version,
        definition_security_revision_id=definition_security_revision_id,
        provider_client_id=provider_client_id,
        credential_audience=credential_audience,
        settings_json=settings_json,
        requested_scopes_json=requested_scopes_json,
        effective_scopes_json=effective_scopes_json,
        staged_credential_ciphertext=staged_credential_ciphertext,
        staged_credential_format=staged_credential_format,
        expires_at=expires_at,
        created_at=now,
        updated_at=now,
    )
    db.add(created)
    await db.flush()
    await db.refresh(created)
    return _record(created)


async def supersede_authorization_attempts(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    definition_id: UUID,
    failure_code: str,
) -> tuple[IntegrationAuthorizationAttemptRecord, ...]:
    """Close all current work while holding the shared lifecycle lock."""

    await acquire_authorization_attempt_lock(
        db,
        owner_user_id=owner_user_id,
        definition_id=definition_id,
    )
    rows = list(
        (
            await db.scalars(
                select(CloudIntegrationAuthorizationAttempt)
                .where(
                    CloudIntegrationAuthorizationAttempt.owner_user_id == owner_user_id,
                    CloudIntegrationAuthorizationAttempt.definition_id == definition_id,
                    CloudIntegrationAuthorizationAttempt.status.in_(NONTERMINAL_ATTEMPT_STATUSES),
                )
                .order_by(CloudIntegrationAuthorizationAttempt.generation)
                .with_for_update()
            )
        ).all()
    )
    now = utcnow()
    for row in rows:
        _terminalize(
            row,
            status="superseded",
            failure_code=failure_code,
            now=now,
        )
    await db.flush()
    return tuple(_record(row) for row in rows)


async def claim_authorization_attempt(
    db: AsyncSession,
    *,
    attempt_id: UUID,
    from_status: str,
    to_status: str,
) -> IntegrationAuthorizationAttemptRecord | None:
    identity = await db.get(CloudIntegrationAuthorizationAttempt, attempt_id)
    if identity is None:
        return None
    await acquire_authorization_attempt_lock(
        db,
        owner_user_id=identity.owner_user_id,
        definition_id=identity.definition_id,
    )
    row = await db.scalar(
        select(CloudIntegrationAuthorizationAttempt)
        .where(CloudIntegrationAuthorizationAttempt.id == attempt_id)
        .with_for_update()
    )
    if row is None or row.status != from_status:
        return None
    now = utcnow()
    if row.expires_at <= now:
        _terminalize(row, status="expired", failure_code="expired", now=now)
        await db.flush()
        return None
    row.status = to_status
    row.updated_at = now
    await db.flush()
    await db.refresh(row)
    return _record(row)


async def stage_authorization_credential(
    db: AsyncSession,
    *,
    attempt_id: UUID,
    expected_status: str,
    credential_ciphertext: str,
    credential_format: str,
    effective_scopes_json: str | None,
) -> IntegrationAuthorizationAttemptRecord | None:
    identity = await db.get(CloudIntegrationAuthorizationAttempt, attempt_id)
    if identity is None:
        return None
    await acquire_authorization_attempt_lock(
        db,
        owner_user_id=identity.owner_user_id,
        definition_id=identity.definition_id,
    )
    row = await db.scalar(
        select(CloudIntegrationAuthorizationAttempt)
        .where(CloudIntegrationAuthorizationAttempt.id == attempt_id)
        .with_for_update()
    )
    if row is None or row.status != expected_status:
        return None
    now = utcnow()
    if row.expires_at <= now:
        _terminalize(row, status="expired", failure_code="expired", now=now)
        await db.flush()
        return None
    row.staged_credential_ciphertext = credential_ciphertext
    row.staged_credential_format = credential_format
    row.effective_scopes_json = effective_scopes_json
    row.status = "validating"
    row.updated_at = now
    await db.flush()
    await db.refresh(row)
    return _record(row)


async def terminalize_authorization_attempt(
    db: AsyncSession,
    *,
    attempt_id: UUID,
    status: str,
    failure_code: str | None,
    owner_user_id: UUID | None = None,
) -> IntegrationAuthorizationAttemptRecord | None:
    if status not in TERMINAL_ATTEMPT_STATUSES:
        raise ValueError(f"unsupported terminal attempt status: {status}")
    identity = await db.get(CloudIntegrationAuthorizationAttempt, attempt_id)
    if identity is None or (owner_user_id is not None and identity.owner_user_id != owner_user_id):
        return None
    await acquire_authorization_attempt_lock(
        db,
        owner_user_id=identity.owner_user_id,
        definition_id=identity.definition_id,
    )
    statement = select(CloudIntegrationAuthorizationAttempt).where(
        CloudIntegrationAuthorizationAttempt.id == attempt_id
    )
    if owner_user_id is not None:
        statement = statement.where(
            CloudIntegrationAuthorizationAttempt.owner_user_id == owner_user_id
        )
    row = (await db.scalars(statement.with_for_update())).one_or_none()
    if row is None:
        return None
    if row.status in NONTERMINAL_ATTEMPT_STATUSES:
        _terminalize(
            row,
            status=status,
            failure_code=failure_code,
            now=utcnow(),
        )
        await db.flush()
        await db.refresh(row)
    return _record(row)


async def expire_authorization_attempt_if_due(
    db: AsyncSession,
    attempt_id: UUID,
) -> IntegrationAuthorizationAttemptRecord | None:
    identity = await db.get(CloudIntegrationAuthorizationAttempt, attempt_id)
    if identity is None:
        return None
    await acquire_authorization_attempt_lock(
        db,
        owner_user_id=identity.owner_user_id,
        definition_id=identity.definition_id,
    )
    row = await db.scalar(
        select(CloudIntegrationAuthorizationAttempt)
        .where(CloudIntegrationAuthorizationAttempt.id == attempt_id)
        .with_for_update()
    )
    if row is None:
        return None
    if row.status in NONTERMINAL_ATTEMPT_STATUSES and row.expires_at <= utcnow():
        _terminalize(
            row,
            status="expired",
            failure_code="expired",
            now=utcnow(),
        )
        await db.flush()
        await db.refresh(row)
    return _record(row)


async def commit_authorization_attempt(
    db: AsyncSession,
    *,
    attempt_id: UUID,
    token_expires_at: datetime | None,
) -> IntegrationAccountRecord | None:
    """Commit staged credentials iff generation and starting versions still win."""

    identity = await db.get(CloudIntegrationAuthorizationAttempt, attempt_id)
    if identity is None:
        return None
    await acquire_authorization_attempt_lock(
        db,
        owner_user_id=identity.owner_user_id,
        definition_id=identity.definition_id,
    )
    attempt = await db.scalar(
        select(CloudIntegrationAuthorizationAttempt)
        .where(CloudIntegrationAuthorizationAttempt.id == attempt_id)
        .with_for_update()
    )
    if attempt is None or attempt.status != "validating":
        return None
    now = utcnow()
    if attempt.expires_at <= now:
        _terminalize(attempt, status="expired", failure_code="expired", now=now)
        await db.flush()
        return None
    if attempt.method != "none" and (
        attempt.staged_credential_ciphertext is None or attempt.staged_credential_format is None
    ):
        _terminalize(
            attempt,
            status="failed",
            failure_code="credential_missing",
            now=now,
        )
        await db.flush()
        return None

    account = await db.scalar(
        select(CloudIntegrationAccount)
        .where(
            CloudIntegrationAccount.owner_user_id == attempt.owner_user_id,
            CloudIntegrationAccount.definition_id == attempt.definition_id,
        )
        .with_for_update()
    )
    if attempt.purpose == "connect":
        if account is not None:
            _terminalize(
                attempt,
                status="superseded",
                failure_code="stale_connection",
                now=now,
            )
            await db.flush()
            return None
        account = CloudIntegrationAccount(
            definition_id=attempt.definition_id,
            owner_user_id=attempt.owner_user_id,
            owner_scope="personal",
            enabled=True,
            status="ready",
            auth_kind=attempt.method,
            credential_ciphertext=attempt.staged_credential_ciphertext,
            credential_format=attempt.staged_credential_format,
            auth_version=1,
            grant_version=1,
            credential_version=1,
            definition_security_revision_id=attempt.definition_security_revision_id,
            provider_client_id=attempt.provider_client_id,
            credential_audience=attempt.credential_audience,
            effective_scopes_json=attempt.effective_scopes_json,
            settings_json=attempt.settings_json,
            token_expires_at=token_expires_at,
            created_at=now,
            updated_at=now,
        )
        db.add(account)
    else:
        versions_match = (
            account is not None
            and account.id == attempt.account_id
            and account.grant_version == attempt.starting_grant_version
            and account.credential_version == attempt.starting_credential_version
        )
        if not versions_match or account is None:
            _terminalize(
                attempt,
                status="superseded",
                failure_code="stale_connection",
                now=now,
            )
            await db.flush()
            return None
        scopes_match = effective_scope_authority_matches(
            account.effective_scopes_json,
            attempt.effective_scopes_json,
        )
        grant_changed = (
            account.auth_kind != attempt.method
            or account.definition_security_revision_id != attempt.definition_security_revision_id
            or account.provider_client_id != attempt.provider_client_id
            or account.credential_audience != attempt.credential_audience
            or not scopes_match
            or account.settings_json != attempt.settings_json
        )
        account.auth_kind = attempt.method
        account.credential_ciphertext = attempt.staged_credential_ciphertext
        account.credential_format = attempt.staged_credential_format
        account.status = "ready"
        account.auth_version += 1
        if grant_changed:
            account.grant_version += 1
        account.credential_version += 1
        account.definition_security_revision_id = attempt.definition_security_revision_id
        account.provider_client_id = attempt.provider_client_id
        account.credential_audience = attempt.credential_audience
        if not scopes_match:
            account.effective_scopes_json = attempt.effective_scopes_json
        account.settings_json = attempt.settings_json
        account.token_expires_at = token_expires_at
        account.last_error_code = None
        account.updated_at = now

    await db.flush()
    _terminalize(attempt, status="succeeded", failure_code=None, now=now)
    await db.flush()
    await db.refresh(account)
    return account_record_from_row(account)
