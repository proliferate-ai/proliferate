"""Bearer authentication for enrolled runtime workers."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.db.store import runtime_workers as runtime_workers_store
from proliferate.server.cloud.errors import CloudApiError


@dataclass(frozen=True)
class WorkerAuthContext:
    worker_id: UUID
    owner_user_id: UUID
    organization_id: UUID | None
    runtime_kind: str


def bearer_token_from_request(request: Request) -> str:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise CloudApiError(
            "cloud_worker_unauthorized",
            "Missing or malformed worker bearer token.",
            status_code=401,
        )
    return token.strip()


async def authenticate_worker(
    request: Request,
    db: AsyncSession = Depends(get_async_session),
) -> WorkerAuthContext:
    token = bearer_token_from_request(request)
    worker = await runtime_workers_store.get_worker_by_token_hash(
        db,
        token_hash=runtime_workers_store.hash_worker_token(token),
    )
    if worker is None:
        raise CloudApiError(
            "cloud_worker_unauthorized",
            "Worker token is invalid or revoked.",
            status_code=401,
        )
    return WorkerAuthContext(
        worker_id=worker.id,
        owner_user_id=worker.owner_user_id,
        organization_id=worker.organization_id,
        runtime_kind=worker.runtime_kind,
    )
