"""HTTP and real-Postgres acceptance tests for workflow invocation history, cancel, and abandon."""

from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import workflow_deliveries as delivery_store
from proliferate.db.store import workflow_delivery_loss
from tests.integration.cloud_api_helpers import register_and_login
from tests.integration.workflow_invocation_helpers import (
    ACCEPT_TARGET,
    CLEANUP_BLOCKED_OBSERVATION,
    INSTALL_ID,
    _create_definition,
    _force_accept,
    _headers,
    _invocation_payload,
    _invoke,
    _outbox_count,
    _outbox_count_for_invocation,
    _project,
    _seed_desktop_worker,
)

pytestmark = pytest.mark.asyncio


class TestHistoryDetailOwnership:
    async def test_history_is_owner_scoped_and_newest_first(self, client: AsyncClient) -> None:
        owner = await register_and_login(client, "wf-hist-owner@example.com")
        intruder = await register_and_login(client, "wf-hist-intruder@example.com")
        definition = await _create_definition(client, owner)
        first = await _invoke(client, owner, definition["id"], key="key-h1")
        second = await _invoke(
            client,
            owner,
            definition["id"],
            key="key-h2",
            payload=_invocation_payload(inputs={"ticket": "PRO-2"}),
        )
        assert first.status_code == 201 and second.status_code == 201

        listed = await client.get("/v1/workflows/invocations", headers=_headers(owner))
        assert listed.status_code == 200
        ids = [entry["id"] for entry in listed.json()["invocations"]]
        assert ids == [second.json()["id"], first.json()["id"]]

        filtered = await client.get(
            "/v1/workflows/invocations",
            params={"workflowDefinitionId": definition["id"]},
            headers=_headers(owner),
        )
        assert len(filtered.json()["invocations"]) == 2

        intruder_list = await client.get("/v1/workflows/invocations", headers=_headers(intruder))
        assert intruder_list.json()["invocations"] == []

        intruder_detail = await client.get(
            f"/v1/workflows/invocations/{first.json()['id']}",
            headers=_headers(intruder),
        )
        assert intruder_detail.status_code == 404
        assert intruder_detail.json()["detail"]["code"] == "workflow_invocation_not_found"

    async def test_cross_user_cancel_and_abandon_are_404(self, client: AsyncClient) -> None:
        owner = await register_and_login(client, "wf-sec-owner@example.com")
        intruder = await register_and_login(client, "wf-sec-intruder@example.com")
        definition = await _create_definition(client, owner)
        created = await _invoke(client, owner, definition["id"], key="key-x")
        invocation_id = created.json()["id"]
        for path in ("cancel", "abandon-controlled-sessions"):
            response = await client.post(
                f"/v1/workflows/invocations/{invocation_id}/{path}",
                headers=_headers(intruder),
            )
            assert response.status_code == 404


class TestCancelAndAbandon:
    async def test_cancel_queued_is_terminal_without_convergence_task(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        owner = await register_and_login(client, "wf-cq-owner@example.com")
        definition = await _create_definition(client, owner)
        created = await _invoke(client, owner, definition["id"], key="key-cq")
        invocation_id = created.json()["id"]

        cancelled = await client.post(
            f"/v1/workflows/invocations/{invocation_id}/cancel",
            headers=_headers(owner),
        )
        assert cancelled.status_code == 200
        delivery = cancelled.json()["delivery"]
        assert delivery["status"] == "cancelled"
        assert delivery["cancelRequestedAt"] is not None
        assert delivery["finishedAt"] is not None
        assert await _outbox_count(db_session, "workflows.cancel_managed_run", invocation_id) == 0

        again = await client.post(
            f"/v1/workflows/invocations/{invocation_id}/cancel",
            headers=_headers(owner),
        )
        assert again.status_code == 200
        assert again.json()["delivery"]["cancelRequestedAt"] == (delivery["cancelRequestedAt"])

    async def test_cancel_after_handoff_enqueues_convergence_once(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        owner = await register_and_login(client, "wf-ch-owner@example.com")
        definition = await _create_definition(client, owner)
        created = await _invoke(client, owner, definition["id"], key="key-ch")
        invocation_id = created.json()["id"]
        await delivery_store.mark_delivery_handoff_started(
            db_session, invocation_id=UUID(invocation_id), expected_target=ACCEPT_TARGET
        )
        await db_session.commit()

        cancelled = await client.post(
            f"/v1/workflows/invocations/{invocation_id}/cancel",
            headers=_headers(owner),
        )
        assert cancelled.status_code == 200
        delivery = cancelled.json()["delivery"]
        assert delivery["status"] == "delivering"
        assert delivery["cancelRequestedAt"] is not None
        assert await _outbox_count(db_session, "workflows.cancel_managed_run", invocation_id) == 1
        # Positive control for the key-agnostic count used by the no-op proofs.
        assert (
            await _outbox_count_for_invocation(
                db_session, "workflows.cancel_managed_run", invocation_id
            )
            == 1
        )

        again = await client.post(
            f"/v1/workflows/invocations/{invocation_id}/cancel",
            headers=_headers(owner),
        )
        assert again.status_code == 200
        assert await _outbox_count(db_session, "workflows.cancel_managed_run", invocation_id) == 1

    async def test_cancel_after_running_observation_enqueues_convergence(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        owner = await register_and_login(client, "wf-cr-owner@example.com")
        definition = await _create_definition(client, owner)
        created = await _invoke(client, owner, definition["id"], key="key-cr")
        invocation_id = created.json()["id"]
        await _force_accept(db_session, UUID(invocation_id))
        await _project(
            db_session,
            UUID(invocation_id),
            revision=1,
            observation={"status": "running"},
        )

        cancelled = await client.post(
            f"/v1/workflows/invocations/{invocation_id}/cancel",
            headers=_headers(owner),
        )
        assert cancelled.status_code == 200
        delivery = cancelled.json()["delivery"]
        assert delivery["status"] == "accepted"
        assert delivery["cancelRequestedAt"] is not None
        assert (
            await _outbox_count_for_invocation(
                db_session, "workflows.cancel_managed_run", invocation_id
            )
            == 1
        )

    async def test_abandon_requires_typed_cleanup_blocked_finalization(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        owner = await register_and_login(client, "wf-ab-owner@example.com")
        definition = await _create_definition(client, owner)
        created = await _invoke(client, owner, definition["id"], key="key-ab")
        invocation_id = created.json()["id"]
        abandon_path = f"/v1/workflows/invocations/{invocation_id}/abandon-controlled-sessions"

        premature = await client.post(abandon_path, headers=_headers(owner))
        assert premature.status_code == 409
        assert premature.json()["detail"]["code"] == "workflow_abandon_not_available"

        await _force_accept(db_session, UUID(invocation_id))

        # Accepted alone is not enough: without a typed cleanup-blocked
        # observation, a premature abandon must not poison the run.
        unblocked = await client.post(abandon_path, headers=_headers(owner))
        assert unblocked.status_code == 409
        assert unblocked.json()["detail"]["code"] == "workflow_abandon_not_available"

        await _project(
            db_session,
            UUID(invocation_id),
            revision=7,
            observation=CLEANUP_BLOCKED_OBSERVATION,
        )
        first_key = f"workflows.abandon_managed_run:{invocation_id}:7"
        accepted = await client.post(abandon_path, headers=_headers(owner))
        assert accepted.status_code == 202, accepted.text
        assert (
            await _outbox_count(
                db_session, "workflows.abandon_managed_run", invocation_id, key=first_key
            )
            == 1
        )

        repeat = await client.post(abandon_path, headers=_headers(owner))
        assert repeat.status_code == 202
        assert (
            await _outbox_count(
                db_session, "workflows.abandon_managed_run", invocation_id, key=first_key
            )
            == 1
        )

        # A later, higher-revision cleanup block is a fresh confirmation:
        # the revision-scoped key lets it enqueue instead of being swallowed.
        await _project(
            db_session,
            UUID(invocation_id),
            revision=9,
            observation=CLEANUP_BLOCKED_OBSERVATION,
        )
        again = await client.post(abandon_path, headers=_headers(owner))
        assert again.status_code == 202
        assert (
            await _outbox_count(
                db_session,
                "workflows.abandon_managed_run",
                invocation_id,
                key=f"workflows.abandon_managed_run:{invocation_id}:9",
            )
            == 1
        )

    async def test_cancel_after_runtime_lost_records_marker_without_convergence(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        owner = await register_and_login(client, "wf-lost-owner@example.com")
        definition = await _create_definition(client, owner)
        created = await _invoke(client, owner, definition["id"], key="key-lost")
        invocation_id = created.json()["id"]
        await _force_accept(db_session, UUID(invocation_id))
        delivery = await delivery_store.get_workflow_delivery(
            db_session, invocation_id=UUID(invocation_id)
        )
        assert delivery is not None and delivery.runtime_payload_digest is not None
        assert delivery.anyharness_data_epoch is not None
        lost = await workflow_delivery_loss.record_runtime_lost_sandbox_destroyed(
            db_session,
            invocation_id=UUID(invocation_id),
            expected_status="accepted",
            expected_runtime_revision=delivery.runtime_revision,
            expected_runtime_payload_digest=delivery.runtime_payload_digest,
            expected_data_epoch=delivery.anyharness_data_epoch,
            expected_target=ACCEPT_TARGET,
        )
        assert lost is not None
        await db_session.commit()

        cancelled = await client.post(
            f"/v1/workflows/invocations/{invocation_id}/cancel",
            headers=_headers(owner),
        )
        assert cancelled.status_code == 200
        delivery = cancelled.json()["delivery"]
        assert delivery["status"] == "accepted"
        assert delivery["cancelRequestedAt"] is not None
        assert delivery["controlPlaneRuntimeOutcome"] == "runtime_lost"
        # No target remains to converge at: no convergence task is enqueued.
        assert await _outbox_count(db_session, "workflows.cancel_managed_run", invocation_id) == 0

    async def test_cancel_after_terminal_observation_is_a_no_op(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        owner = await register_and_login(client, "wf-term-owner@example.com")
        definition = await _create_definition(client, owner)
        created = await _invoke(client, owner, definition["id"], key="key-term")
        invocation_id = created.json()["id"]
        await _force_accept(db_session, UUID(invocation_id))
        await _project(
            db_session,
            UUID(invocation_id),
            revision=1,
            observation={"status": "succeeded"},
        )

        cancelled = await client.post(
            f"/v1/workflows/invocations/{invocation_id}/cancel",
            headers=_headers(owner),
        )
        assert cancelled.status_code == 200
        delivery = cancelled.json()["delivery"]
        assert delivery["status"] == "accepted"
        # The projection is the run's result: no late cancel marker is
        # written and no convergence task is enqueued under any key.
        assert delivery["cancelRequestedAt"] is None
        assert (
            await _outbox_count_for_invocation(
                db_session, "workflows.cancel_managed_run", invocation_id
            )
            == 0
        )

    async def test_abandon_rejected_for_desktop_target(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        owner = await register_and_login(client, "wf-abd-owner@example.com")
        await _seed_desktop_worker(db_session, user_id=owner["user_id"])
        definition = await _create_definition(client, owner)
        created = await _invoke(
            client,
            owner,
            definition["id"],
            key="key-abd",
            payload=_invocation_payload(
                target={"kind": "desktop", "desktopInstallId": INSTALL_ID}
            ),
        )
        assert created.status_code == 201
        response = await client.post(
            f"/v1/workflows/invocations/{created.json()['id']}/abandon-controlled-sessions",
            headers=_headers(owner),
        )
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "workflow_abandon_not_available"
