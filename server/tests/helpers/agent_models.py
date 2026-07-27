"""Shared fixtures for the cloud model-snapshot tests.

Extracted so the layered-read suite and the Worker-ingest suite can each stay
under the repo line budget while sharing one definition of "a composed machine
document" and "a cloud-sandbox worker".
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import OAuthAccount
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store import runtime_workers as runtime_workers_store
from tests.helpers.desktop_auth import mint_desktop_token_payload

HARNESS = "claude"
MODELS_PATH = f"/v1/cloud/agent-models/{HARNESS}"
PROBED_AT = "2026-07-24T09:12:03+00:00"


def snapshot_document(
    models: list[str],
    *,
    modes: list[str] | None = None,
    agent: str = HARNESS,
) -> str:
    """One composed machine document (schemaVersion 2), as the Worker uploads it.

    Mirrors what ``model_snapshot_sync.rs`` reassembles off the runtime's status
    route: the composed observation plus its provenance fields — no ``entries``
    map, no ``authFingerprint``, no per-context anything.
    """
    return json.dumps(
        {
            "schemaVersion": 2,
            "agent": agent,
            "probedAt": PROBED_AT,
            "attestation": {"name": agent, "version": "1.2.3"},
            "installIdentity": {
                "role": "agent_process",
                "version": "1.18.3",
                "sha256": "9b4f9f1b1c00",
                "source": "pinned_archive",
            },
            "stateRevision": 1721820000000,
            "models": [{"id": model} for model in models],
            "modes": [{"id": mode} for mode in (modes or ["build"])],
            "warnings": [],
            "lastAttempt": {"at": PROBED_AT, "outcome": "ok", "detail": None},
        }
    )


def model_ids(payload: dict) -> list[str]:
    return [entry["id"] for entry in payload["models"]]


async def register_and_login(client: AsyncClient, email: str) -> dict[str, str]:
    from proliferate.auth.models import UserCreate
    from proliferate.auth.users import UserManager, get_user_db
    from proliferate.db.engine import get_async_session

    user_id: str | None = None
    async for session in get_async_session():
        async for user_db in get_user_db(session):
            manager = UserManager(user_db)
            user = await manager.create(
                UserCreate(
                    email=email,
                    password="unused-oauth-only",
                    display_name="Model Snapshot Tester",
                ),
            )
            session.add(
                OAuthAccount(
                    user_id=user.id,
                    oauth_name="github",
                    access_token="github-access-token",
                    account_id=f"github-{user.id}",
                    account_email=email,
                )
            )
            await session.commit()
            user_id = str(user.id)

    assert user_id is not None
    token_data = await mint_desktop_token_payload(
        client,
        user_id=user_id,
        state_prefix="agent-models",
    )
    return {"user_id": user_id, "access_token": str(token_data["access_token"])}


async def authed_user(client: AsyncClient) -> tuple[str, dict[str, str]]:
    tokens = await register_and_login(
        client,
        f"agent-models-api-{uuid.uuid4().hex[:8]}@example.com",
    )
    return tokens["user_id"], {"Authorization": f"Bearer {tokens['access_token']}"}


async def _enrolled_worker_headers(
    db_session: AsyncSession,
    *,
    owner_user_id: uuid.UUID,
    runtime_kind: str,
    cloud_sandbox_id: uuid.UUID | None,
    desktop_install_id: str | None,
) -> dict[str, str]:
    enrollment = await runtime_workers_store.create_enrollment(
        db_session,
        owner_user_id=owner_user_id,
        organization_id=None,
        runtime_kind=runtime_kind,
        cloud_sandbox_id=cloud_sandbox_id,
        desktop_install_id=desktop_install_id,
        created_by_user_id=owner_user_id,
        token_hash=runtime_workers_store.hash_enrollment_token(uuid.uuid4().hex),
        expires_at=datetime(2030, 1, 1, tzinfo=UTC),
    )
    worker_token = f"worker-{uuid.uuid4().hex}"
    await runtime_workers_store.create_worker(
        db_session,
        enrollment=enrollment,
        token_hash=runtime_workers_store.hash_worker_token(worker_token),
    )
    await db_session.commit()
    return {"Authorization": f"Bearer {worker_token}"}


async def cloud_sandbox_worker_headers(
    db_session: AsyncSession,
    *,
    owner_user_id: uuid.UUID,
) -> dict[str, str]:
    """A cloud-sandbox worker's bearer — the only legal snapshot uploader."""
    sandbox = CloudSandbox(
        owner_user_id=owner_user_id,
        sandbox_type="e2b",
        provider_sandbox_id=f"provider-{uuid.uuid4().hex[:10]}",
        status="ready",
    )
    db_session.add(sandbox)
    await db_session.flush()
    return await _enrolled_worker_headers(
        db_session,
        owner_user_id=owner_user_id,
        runtime_kind="cloud_sandbox",
        cloud_sandbox_id=sandbox.id,
        desktop_install_id=None,
    )


async def desktop_worker_headers(
    db_session: AsyncSession,
    *,
    owner_user_id: uuid.UUID,
) -> dict[str, str]:
    return await _enrolled_worker_headers(
        db_session,
        owner_user_id=owner_user_id,
        runtime_kind="desktop",
        cloud_sandbox_id=None,
        desktop_install_id=f"install-{uuid.uuid4().hex[:8]}",
    )


async def store_snapshot(
    db_session: AsyncSession,
    *,
    owner_user_id: uuid.UUID,
    models: list[str],
    harness_kind: str = HARNESS,
    probed_at: datetime | None = None,
) -> None:
    await agent_gateway_store.create_model_snapshot(
        db_session,
        harness_kind=harness_kind,
        owner_user_id=owner_user_id,
        snapshot_json=snapshot_document(models, agent=harness_kind),
        probed_at=probed_at,
    )
    await db_session.commit()
