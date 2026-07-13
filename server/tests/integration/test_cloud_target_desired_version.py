"""Target-scoped desired-version resolution for the Tier-4 managed-cloud upgrade.

Proves the run/target-scoped desired-version channel the T4-RUNTIME-1 world
flips from N-1 to N: a per-sandbox record overrides the global image-env pin for
*that target only*, unrelated targets keep the global pin, and an unset
component defers to the global pin. This is the small, clearly-owned server
piece that lets the upgrade world avoid mutating a shared global staging pin.
"""

from __future__ import annotations

import uuid
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudSandboxStatus
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.store import cloud_desired_versions as desired_store
from proliferate.db.store import runtime_workers as worker_store
from proliferate.server.cloud.runtime_workers.service import (
    create_cloud_sandbox_enrollment,
    record_heartbeat,
)


@pytest.fixture(autouse=True)
def _pins(monkeypatch: pytest.MonkeyPatch) -> None:
    # A stamped global pin (the "N-1" the whole fleet is on).
    monkeypatch.setenv("RUNTIME_VERSION", "8.8.8")
    monkeypatch.setenv("WORKER_VERSION", "9.9.9")


async def _sandbox_worker(db: AsyncSession, *, prefix: str) -> tuple[UUID, UUID]:
    """A cloud-sandbox worker enrolled for a fresh sandbox; returns (sandbox_id, worker_id)."""
    user = User(
        email=f"{prefix}-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    sandbox = CloudSandbox(
        owner_user_id=user.id,
        provider_sandbox_id=f"sandbox-{uuid.uuid4().hex[:8]}",
        status=CloudSandboxStatus.ready,
        anyharness_base_url=None,
        runtime_token_ciphertext=None,
        anyharness_data_key_ciphertext=None,
    )
    db.add(sandbox)
    await db.flush()

    token = await create_cloud_sandbox_enrollment(
        db, cloud_sandbox_id=sandbox.id, owner_user_id=user.id
    )
    enrollment = await worker_store.consume_pending_enrollment_by_hash(
        db, token_hash=worker_store.hash_enrollment_token(token)
    )
    assert enrollment is not None
    worker = await worker_store.create_worker(
        db,
        enrollment=enrollment,
        token_hash=worker_store.hash_worker_token(secrets_token()),
        worker_version="9.9.9",
        anyharness_version="8.8.8",
    )
    return sandbox.id, worker.id


def secrets_token() -> str:
    import secrets

    return secrets.token_urlsafe(32)


class TestTargetScopedDesiredVersion:
    @pytest.mark.asyncio
    async def test_defaults_to_global_pin_without_a_record(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        _sandbox_id, worker_id = await _sandbox_worker(db_session, prefix="dv-default")
        response = await record_heartbeat(db_session, worker_id=worker_id)
        assert response.desired_versions.anyharness == "8.8.8"
        assert response.desired_versions.worker == "9.9.9"

    @pytest.mark.asyncio
    async def test_target_record_overrides_global_pin_for_that_target_only(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        sandbox_a, worker_a = await _sandbox_worker(db_session, prefix="dv-a")
        _sandbox_b, worker_b = await _sandbox_worker(db_session, prefix="dv-b")

        # Flip only target A's desired AnyHarness version to the candidate N.
        await desired_store.set_for_sandbox(
            db_session, cloud_sandbox_id=sandbox_a, anyharness="9.0.0"
        )

        resp_a = await record_heartbeat(db_session, worker_id=worker_a)
        resp_b = await record_heartbeat(db_session, worker_id=worker_b)

        # Target A converges toward N; the worker pin (unset) still defers global.
        assert resp_a.desired_versions.anyharness == "9.0.0"
        assert resp_a.desired_versions.worker == "9.9.9"
        # The unrelated target B is completely unaffected.
        assert resp_b.desired_versions.anyharness == "8.8.8"
        assert resp_b.desired_versions.worker == "9.9.9"

    @pytest.mark.asyncio
    async def test_worker_override_is_independent_of_anyharness_override(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        sandbox_id, worker_id = await _sandbox_worker(db_session, prefix="dv-worker")
        await desired_store.set_for_sandbox(
            db_session, cloud_sandbox_id=sandbox_id, worker="9.1.0"
        )
        response = await record_heartbeat(db_session, worker_id=worker_id)
        # Worker pin overridden; AnyHarness (unset) defers to the global pin.
        assert response.desired_versions.worker == "9.1.0"
        assert response.desired_versions.anyharness == "8.8.8"

    @pytest.mark.asyncio
    async def test_set_is_idempotent_and_upserts(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        sandbox_id, _worker_id = await _sandbox_worker(db_session, prefix="dv-upsert")
        first = await desired_store.set_for_sandbox(
            db_session, cloud_sandbox_id=sandbox_id, anyharness="9.0.0"
        )
        assert first.anyharness == "9.0.0"
        # Re-setting the same value does not create a second row.
        again = await desired_store.set_for_sandbox(
            db_session, cloud_sandbox_id=sandbox_id, anyharness="9.0.0"
        )
        assert again.anyharness == "9.0.0"
        # A later set to a different N supersedes in place.
        bumped = await desired_store.set_for_sandbox(
            db_session, cloud_sandbox_id=sandbox_id, anyharness="9.2.0"
        )
        assert bumped.anyharness == "9.2.0"

    @pytest.mark.asyncio
    async def test_clear_reverts_to_global_pin(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        sandbox_id, worker_id = await _sandbox_worker(db_session, prefix="dv-clear")
        await desired_store.set_for_sandbox(
            db_session, cloud_sandbox_id=sandbox_id, anyharness="9.0.0"
        )
        await desired_store.clear_for_sandbox(db_session, cloud_sandbox_id=sandbox_id)
        response = await record_heartbeat(db_session, worker_id=worker_id)
        assert response.desired_versions.anyharness == "8.8.8"

    @pytest.mark.asyncio
    async def test_unstamped_global_pin_with_target_override_still_pins_target(
        self, db_session: AsyncSession, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # An unstamped deployment pins nothing globally, but a target-scoped
        # record must still drive that one target — the world provisions against
        # a candidate API that may not carry a global RUNTIME_VERSION stamp.
        monkeypatch.delenv("RUNTIME_VERSION", raising=False)
        sandbox_id, worker_id = await _sandbox_worker(db_session, prefix="dv-unstamped")
        await desired_store.set_for_sandbox(
            db_session, cloud_sandbox_id=sandbox_id, anyharness="9.0.0"
        )
        response = await record_heartbeat(db_session, worker_id=worker_id)
        assert response.desired_versions.anyharness == "9.0.0"
