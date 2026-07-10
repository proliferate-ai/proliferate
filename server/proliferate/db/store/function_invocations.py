"""Store helpers for ``function_invocation_definition`` rows.

Function invocations are user-authored HTTP functions (Part II mental-model §1)
exposed at the integration gateway under the reserved ``functions`` namespace.
Person-scoped (``owner_user_id``) in v1. Headers are a Fernet-encrypted JSON blob
that is WRITE-ONLY: these helpers set/rotate the ciphertext and decrypt it only at
dispatch time — the plaintext is never returned to a read path.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workflows import FunctionInvocationDefinition
from proliferate.utils.crypto import encrypt_json
from proliferate.utils.time import utcnow

UNSET = object()  # distinguishes "field not supplied" from an explicit None (clear)


@dataclass(frozen=True)
class FunctionInvocationRecord:
    """A read view of an invocation. Note: NO ``headers_ciphertext`` and no header
    plaintext — headers are write-only and never surface on a read path."""

    id: UUID
    owner_user_id: UUID
    organization_id: UUID | None
    name: str
    display_name: str | None
    description: str | None
    endpoint_url: str
    method: str
    args_schema_json: dict[str, object]
    chat_scope_enabled: bool
    has_headers: bool
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


def _record(row: FunctionInvocationDefinition) -> FunctionInvocationRecord:
    return FunctionInvocationRecord(
        id=row.id,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        name=row.name,
        display_name=row.display_name,
        description=row.description,
        endpoint_url=row.endpoint_url,
        method=row.method,
        args_schema_json=dict(row.args_schema_json or {}),
        chat_scope_enabled=row.chat_scope_enabled,
        has_headers=bool(row.headers_ciphertext),
        archived_at=row.archived_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def list_for_owner(
    db: AsyncSession, owner_user_id: UUID
) -> tuple[FunctionInvocationRecord, ...]:
    """The owner's live (non-archived) invocations, ordered by name."""
    rows = (
        await db.scalars(
            select(FunctionInvocationDefinition)
            .where(
                FunctionInvocationDefinition.owner_user_id == owner_user_id,
                FunctionInvocationDefinition.archived_at.is_(None),
            )
            .order_by(FunctionInvocationDefinition.name)
        )
    ).all()
    return tuple(_record(row) for row in rows)


async def get_by_name(
    db: AsyncSession, *, owner_user_id: UUID, name: str
) -> FunctionInvocationRecord | None:
    row = await _row_by_name(db, owner_user_id=owner_user_id, name=name)
    return _record(row) if row is not None else None


async def _row_by_name(
    db: AsyncSession, *, owner_user_id: UUID, name: str
) -> FunctionInvocationDefinition | None:
    return await db.scalar(
        select(FunctionInvocationDefinition).where(
            FunctionInvocationDefinition.owner_user_id == owner_user_id,
            FunctionInvocationDefinition.name == name,
            FunctionInvocationDefinition.archived_at.is_(None),
        )
    )


async def decrypt_headers(db: AsyncSession, *, owner_user_id: UUID, name: str) -> dict[str, str]:
    """Decrypt an invocation's headers blob for dispatch. Only the dispatch path
    calls this; it never surfaces on a read/list response."""
    from proliferate.utils.crypto import decrypt_json

    row = await _row_by_name(db, owner_user_id=owner_user_id, name=name)
    if row is None or not row.headers_ciphertext:
        return {}
    raw = decrypt_json(row.headers_ciphertext)
    return {str(k): str(v) for k, v in raw.items()}


async def create(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    organization_id: UUID | None,
    created_by_user_id: UUID | None,
    name: str,
    endpoint_url: str,
    method: str,
    args_schema_json: dict[str, object],
    headers: dict[str, str] | None = None,
    display_name: str | None = None,
    description: str | None = None,
    chat_scope_enabled: bool = False,
) -> FunctionInvocationRecord:
    """Create an invocation. ``chat_scope_enabled`` defaults False — WORKFLOW-ONLY
    until explicitly enabled for chat (§2 default access modes)."""
    row = FunctionInvocationDefinition(
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        created_by_user_id=created_by_user_id,
        name=name,
        display_name=display_name,
        description=description,
        endpoint_url=endpoint_url,
        method=method,
        args_schema_json=args_schema_json,
        headers_ciphertext=encrypt_json(headers) if headers else None,
        chat_scope_enabled=chat_scope_enabled,
    )
    db.add(row)
    await db.flush()
    return _record(row)


async def update(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    name: str,
    display_name: str | None | object = UNSET,
    description: str | None | object = UNSET,
    endpoint_url: str | None = None,
    method: str | None = None,
    args_schema_json: dict[str, object] | None = None,
) -> FunctionInvocationRecord | None:
    """Update the mutable, non-secret fields of a live invocation. ``name`` and
    headers are not editable here (name is the immutable gateway tool address;
    headers go through ``rotate_headers``). Only supplied fields change:
    ``display_name``/``description`` use the ``UNSET`` sentinel so an explicit
    ``None`` (clear) is distinguishable from "not supplied"; the remaining
    fields default to ``None`` meaning unchanged."""
    row = await _row_by_name(db, owner_user_id=owner_user_id, name=name)
    if row is None:
        return None
    if display_name is not UNSET:
        row.display_name = display_name
    if description is not UNSET:
        row.description = description
    if endpoint_url is not None:
        row.endpoint_url = endpoint_url
    if method is not None:
        row.method = method
    if args_schema_json is not None:
        row.args_schema_json = args_schema_json
    await db.flush()
    return _record(row)


async def rotate_headers(
    db: AsyncSession, *, owner_user_id: UUID, name: str, headers: dict[str, str] | None
) -> FunctionInvocationRecord | None:
    """Set/rotate the encrypted headers blob (write-only). ``None``/empty clears it."""
    row = await _row_by_name(db, owner_user_id=owner_user_id, name=name)
    if row is None:
        return None
    row.headers_ciphertext = encrypt_json(headers) if headers else None
    await db.flush()
    return _record(row)


async def set_chat_scope_enabled(
    db: AsyncSession, *, owner_user_id: UUID, name: str, enabled: bool
) -> FunctionInvocationRecord | None:
    row = await _row_by_name(db, owner_user_id=owner_user_id, name=name)
    if row is None:
        return None
    row.chat_scope_enabled = enabled
    await db.flush()
    return _record(row)


async def archive(db: AsyncSession, *, owner_user_id: UUID, name: str) -> bool:
    row = await _row_by_name(db, owner_user_id=owner_user_id, name=name)
    if row is None:
        return False
    row.archived_at = utcnow()
    await db.flush()
    return True
