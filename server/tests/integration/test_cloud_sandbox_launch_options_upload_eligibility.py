"""The heartbeat's launch-options upload verdict for cloud-sandbox workers.

Split out of ``test_cloud_sandbox_desired_versions.py`` to keep both files under
the repo-wide line cap. This is the REL-10 eligibility matrix on the sandbox side:
a live sandbox resolves to an owner and is allowed, while a destroyed or
owner-less sandbox is authenticated but denied.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from tests.helpers.worker_heartbeat import (
    enroll_sandbox_worker as _enroll_sandbox_worker,
    heartbeat as _heartbeat,
    seed_sandbox as _seed_sandbox,
)


@pytest.fixture(autouse=True)
def _worker_cloud_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "cloud_worker_base_url", "http://cloud.test")


class TestHeartbeatModelSnapshotUploadEligibility:
    """REL-10: the cloud-sandbox half of the advertised snapshot-upload verdict.

    The verdict rides the same authenticated 200 as the version overlay but is
    not desired state: it never alters ``desiredVersions``.
    """

    @pytest.mark.asyncio
    async def test_active_owned_cloud_sandbox_worker_is_allowed(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        sandbox = await _seed_sandbox(db_session, prefix="snapshot-eligible")
        worker_token = await _enroll_sandbox_worker(client, db_session, sandbox=sandbox)

        body = await _heartbeat(client, worker_token)

        assert body["launchOptionsUploadAllowed"] is True

    @pytest.mark.asyncio
    async def test_a_destroyed_sandbox_flips_the_verdict_to_false(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """The same Worker, the same bearer: destruction alone revokes eligibility,
        so the Worker stops uploading on the very next heartbeat."""
        sandbox = await _seed_sandbox(db_session, prefix="snapshot-destroyed")
        worker_token = await _enroll_sandbox_worker(client, db_session, sandbox=sandbox)

        before = await _heartbeat(client, worker_token)
        assert before["launchOptionsUploadAllowed"] is True

        sandbox.destroyed_at = datetime.now(UTC)
        db_session.add(sandbox)
        await db_session.commit()

        after = await _heartbeat(client, worker_token)
        assert after["launchOptionsUploadAllowed"] is False

    @pytest.mark.asyncio
    async def test_the_verdict_does_not_disturb_version_convergence(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Binary versions remain the only desired convergence state: a target
        whose sandbox is destroyed still receives its exact version overlay."""
        monkeypatch.setenv("WORKER_VERSION", "1.0.0")
        monkeypatch.setenv("RUNTIME_VERSION", "1.0.0")
        sandbox = await _seed_sandbox(db_session, prefix="snapshot-overlay")
        sandbox.desired_anyharness_version = "4.4.4"
        sandbox.desired_worker_version = "4.4.4"
        db_session.add(sandbox)
        await db_session.commit()
        worker_token = await _enroll_sandbox_worker(client, db_session, sandbox=sandbox)

        eligible = await _heartbeat(client, worker_token)
        sandbox.destroyed_at = datetime.now(UTC)
        db_session.add(sandbox)
        await db_session.commit()
        ineligible = await _heartbeat(client, worker_token)

        assert eligible["launchOptionsUploadAllowed"] is True
        assert ineligible["launchOptionsUploadAllowed"] is False
        assert eligible["desiredVersions"] == ineligible["desiredVersions"]
        assert ineligible["desiredVersions"]["anyharness"] == "4.4.4"
