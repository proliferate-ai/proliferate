"""Authentication context for local-device and cloud-worker binding routes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.db.store import runtime_workers as worker_store
from proliferate.server.cloud.errors import CloudApiError


@dataclass(frozen=True)
class BindingActor:
    kind: Literal["worker"]
    owner_user_id: UUID
    worker_id: UUID
    runtime_kind: str
    cloud_sandbox_id: UUID | None = None
    desktop_install_id: str | None = None
    generation: int = 0

    @classmethod
    def worker(
        cls,
        *,
        worker_id: UUID,
        owner_user_id: UUID,
        runtime_kind: str,
        cloud_sandbox_id: UUID | None = None,
        desktop_install_id: str | None = None,
        generation: int,
    ) -> BindingActor:
        return cls(
            kind="worker",
            worker_id=worker_id,
            owner_user_id=owner_user_id,
            runtime_kind=runtime_kind,
            cloud_sandbox_id=cloud_sandbox_id,
            desktop_install_id=desktop_install_id,
            generation=generation,
        )


def _bearer(request: Request) -> str:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    return token.strip() if scheme.lower() == "bearer" else ""


async def authenticate_binding_actor(
    request: Request,
    db: AsyncSession = Depends(get_async_session),
) -> BindingActor:
    """Authenticate one enrolled runtime worker for the binding control plane."""

    token = _bearer(request)
    if token:
        worker = await worker_store.get_worker_by_token_hash(
            db, token_hash=worker_store.hash_worker_token(token)
        )
        if worker is not None:
            return BindingActor.worker(
                worker_id=worker.id,
                owner_user_id=worker.owner_user_id,
                runtime_kind=worker.runtime_kind,
                cloud_sandbox_id=worker.cloud_sandbox_id,
                desktop_install_id=worker.desktop_install_id,
                generation=worker.generation,
            )
    raise CloudApiError(
        "workflow_binding_unauthorized",
        "A valid enrolled-worker credential is required.",
        status_code=401,
    )
