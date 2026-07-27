"""Integration tests for the single model-snapshot ingest route (composed re-key, B-3).

Tier 2 (real postgres, real routing, no external services). The route absorbs the
former ``refresh``-with-payload and ``mirror`` endpoints; the only writer is a
cloud-sandbox Worker, the body is the Worker's wire shape verbatim —
``snapshotJson`` (the whole schemaVersion-2 machine document) plus ``probedAt``,
nothing else — and the owner is derived from its sandbox row rather than from
anything the request says.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.agent_gateway import AgentModelSnapshot
from proliferate.db.store import agent_gateway as store
from tests.helpers.agent_models import (
    HARNESS,
    MODELS_PATH,
    PROBED_AT,
    authed_user,
    cloud_sandbox_worker_headers,
    desktop_worker_headers,
    model_ids,
    snapshot_document,
)

INGEST_PATH = f"{MODELS_PATH}/refresh"


def _body(models: list[str], *, probed_at: str = PROBED_AT) -> dict[str, str]:
    """The Worker's exact POST shape (``IngestModelSnapshotRequest`` in
    ``model_snapshot_sync.rs``): snapshotJson + probedAt, keyed by the harness
    in the path — no authContextId, no owner."""
    return {
        "snapshotJson": snapshot_document(models),
        "probedAt": probed_at,
    }


class TestWorkerIngest:
    @pytest.mark.asyncio
    async def test_worker_upload_stores_under_the_sandbox_owner(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, user_headers = await authed_user(client)
        worker = await cloud_sandbox_worker_headers(
            db_session,
            owner_user_id=uuid.UUID(user_id),
        )

        response = await client.post(
            INGEST_PATH,
            json=_body(["uploaded-a", "uploaded-b"]),
            headers=worker,
        )
        assert response.status_code == 200, response.text
        payload = response.json()
        assert model_ids(payload) == ["uploaded-a", "uploaded-b"]
        assert payload["origin"] == "snapshot"
        assert payload["probedAt"] == PROBED_AT

        # Owner derived from the sandbox row: the sandbox owner's read sees it.
        owner_read = await client.get(MODELS_PATH, headers=user_headers)
        assert model_ids(owner_read.json()) == ["uploaded-a", "uploaded-b"]

        stored = await store.get_active_model_snapshot(
            db_session,
            harness_kind=HARNESS,
            owner_user_id=uuid.UUID(user_id),
        )
        assert stored is not None
        assert stored.owner_user_id == uuid.UUID(user_id)

    @pytest.mark.asyncio
    async def test_upload_stores_the_whole_document_verbatim(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """Provenance fields survive so the status surface can render them.

        ``attestation``/``installIdentity``/``stateRevision``/``warnings``/
        ``lastAttempt`` are stored with the lists, not stripped to a
        models-only payload.
        """
        user_id, _ = await authed_user(client)
        worker = await cloud_sandbox_worker_headers(
            db_session,
            owner_user_id=uuid.UUID(user_id),
        )
        response = await client.post(INGEST_PATH, json=_body(["m"]), headers=worker)
        assert response.status_code == 200, response.text

        stored = await store.get_active_model_snapshot(
            db_session,
            harness_kind=HARNESS,
            owner_user_id=uuid.UUID(user_id),
        )
        assert stored is not None
        document = json.loads(stored.snapshot_json)
        assert document["schemaVersion"] == 2
        assert document["attestation"] == {"name": HARNESS, "version": "1.2.3"}
        assert document["installIdentity"]["role"] == "agent_process"
        assert document["stateRevision"] == 1721820000000
        assert document["lastAttempt"]["outcome"] == "ok"
        assert document["modes"] == [{"id": "build"}]

    @pytest.mark.asyncio
    async def test_body_cannot_name_an_owner(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """A spoofed owner in the body is ignored, not honoured.

        The request model has no owner field at all, so an attempt lands the row
        under the uploading sandbox's owner — the victim's snapshot is untouched.
        """
        victim_id, victim_headers = await authed_user(client)
        attacker_id, _ = await authed_user(client)
        worker = await cloud_sandbox_worker_headers(
            db_session,
            owner_user_id=uuid.UUID(attacker_id),
        )

        response = await client.post(
            INGEST_PATH,
            json={
                **_body(["attacker-model"]),
                "ownerUserId": victim_id,
                "owner_user_id": victim_id,
            },
            headers=worker,
        )
        assert response.status_code == 200, response.text

        victim_read = await client.get(MODELS_PATH, headers=victim_headers)
        assert victim_read.json()["origin"] == "catalog"
        assert "attacker-model" not in model_ids(victim_read.json())

        assert (
            await store.get_active_model_snapshot(
                db_session,
                harness_kind=HARNESS,
                owner_user_id=uuid.UUID(victim_id),
            )
            is None
        )
        attacker_row = await store.get_active_model_snapshot(
            db_session,
            harness_kind=HARNESS,
            owner_user_id=uuid.UUID(attacker_id),
        )
        assert attacker_row is not None

    @pytest.mark.asyncio
    async def test_desktop_worker_upload_is_refused(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """ "The desktop does not sync" is enforced, not merely documented."""
        user_id, _ = await authed_user(client)
        worker = await desktop_worker_headers(db_session, owner_user_id=uuid.UUID(user_id))

        response = await client.post(
            INGEST_PATH,
            json=_body(["desktop-model"]),
            headers=worker,
        )
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "agent_model_snapshot_upload_forbidden"

    @pytest.mark.asyncio
    async def test_ingest_requires_a_worker_bearer(self, client: AsyncClient) -> None:
        anonymous = await client.post(INGEST_PATH, json=_body(["m"]))
        assert anonymous.status_code == 401

    @pytest.mark.asyncio
    async def test_a_users_own_bearer_is_not_a_worker_bearer(
        self,
        client: AsyncClient,
    ) -> None:
        """The product user token must not double as an upload credential."""
        _, headers = await authed_user(client)
        response = await client.post(INGEST_PATH, json=_body(["m"]), headers=headers)
        assert response.status_code == 401
        assert response.json()["detail"]["code"] == "cloud_worker_unauthorized"

    @pytest.mark.asyncio
    async def test_invalid_document_payloads_are_400(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, _ = await authed_user(client)
        worker = await cloud_sandbox_worker_headers(
            db_session,
            owner_user_id=uuid.UUID(user_id),
        )

        for bad_document in (
            "not-json",
            json.dumps(["array"]),
            json.dumps({"schemaVersion": 2, "models": [{"x": 1}]}),
        ):
            response = await client.post(
                INGEST_PATH,
                json={"snapshotJson": bad_document, "probedAt": PROBED_AT},
                headers=worker,
            )
            assert response.status_code == 400, bad_document
            assert response.json()["detail"]["code"] == "invalid_agent_model_snapshot"

    @pytest.mark.asyncio
    async def test_non_v2_schema_versions_are_refused(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """The cutover is hard: a v1 per-context entry is never reinterpreted.

        A document missing ``schemaVersion``, carrying 1, or carrying an
        ``entries`` map is a pre-re-cut runtime talking to a post-re-cut
        server; the honest answer is a 400 the Worker logs and retries after
        its runtime updates — not a silent store of a context slice as if it
        were the composed observation.
        """
        user_id, _ = await authed_user(client)
        worker = await cloud_sandbox_worker_headers(
            db_session,
            owner_user_id=uuid.UUID(user_id),
        )
        v2 = json.loads(snapshot_document(["m"]))
        for mutate in (
            lambda d: d.pop("schemaVersion"),
            lambda d: d.update(schemaVersion=1),
            lambda d: d.update(schemaVersion="2"),
        ):
            document = dict(v2)
            mutate(document)
            response = await client.post(
                INGEST_PATH,
                json={"snapshotJson": json.dumps(document), "probedAt": PROBED_AT},
                headers=worker,
            )
            assert response.status_code == 400, document.get("schemaVersion")
            assert response.json()["detail"]["code"] == "invalid_agent_model_snapshot"
            assert "schemaVersion" in response.json()["detail"]["message"]

        # And nothing was stored along the way.
        assert (
            await store.get_active_model_snapshot(
                db_session,
                harness_kind=HARNESS,
                owner_user_id=uuid.UUID(user_id),
            )
            is None
        )

    @pytest.mark.asyncio
    async def test_invalid_probed_at_is_400(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, _ = await authed_user(client)
        worker = await cloud_sandbox_worker_headers(
            db_session,
            owner_user_id=uuid.UUID(user_id),
        )
        response = await client.post(
            INGEST_PATH,
            json=_body(["m"], probed_at="yesterday"),
            headers=worker,
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_model_snapshot"

    @pytest.mark.asyncio
    async def test_overlong_harness_kind_is_400(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, _ = await authed_user(client)
        worker = await cloud_sandbox_worker_headers(
            db_session,
            owner_user_id=uuid.UUID(user_id),
        )
        long_harness = await client.post(
            f"/v1/cloud/agent-models/{'x' * 65}/refresh",
            json=_body(["m"]),
            headers=worker,
        )
        assert long_harness.status_code == 400
        assert long_harness.json()["detail"]["code"] == "invalid_agent_harness_kind"


class TestIngestSoftVersioning:
    @pytest.mark.asyncio
    async def test_repeated_uploads_keep_one_active_row_and_retain_history(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, headers = await authed_user(client)
        worker = await cloud_sandbox_worker_headers(
            db_session,
            owner_user_id=uuid.UUID(user_id),
        )

        for index, models in enumerate((["a", "b"], ["c"], ["d", "e", "f"])):
            response = await client.post(
                INGEST_PATH,
                json=_body(models, probed_at=f"2026-07-2{4 + index}T09:12:03+00:00"),
                headers=worker,
            )
            assert response.status_code == 200, response.text

        db_session.expire_all()

        async def count(status: str) -> int:
            result = await db_session.execute(
                select(func.count())
                .select_from(AgentModelSnapshot)
                .where(
                    AgentModelSnapshot.harness_kind == HARNESS,
                    AgentModelSnapshot.owner_user_id == uuid.UUID(user_id),
                    AgentModelSnapshot.status == status,
                )
            )
            return int(result.scalar_one())

        assert await count("active") == 1
        # The audit trail the spec asks for: prior writes are retained inactive.
        assert await count("inactive") == 2

        latest = await client.get(MODELS_PATH, headers=headers)
        assert model_ids(latest.json()) == ["d", "e", "f"]

    @pytest.mark.asyncio
    async def test_a_redundant_reupload_is_absorbed_idempotently(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """A Worker restart re-sends its last document; the write must absorb it.

        The spec accepts "at most one redundant upload after a Worker restart"
        precisely because the soft-versioned write handles it — so the same
        document twice must leave exactly one active row, not a
        unique-violation 500.
        """
        user_id, _ = await authed_user(client)
        worker = await cloud_sandbox_worker_headers(
            db_session,
            owner_user_id=uuid.UUID(user_id),
        )
        body = _body(["same", "entry"])

        first = await client.post(INGEST_PATH, json=body, headers=worker)
        second = await client.post(INGEST_PATH, json=body, headers=worker)
        assert first.status_code == 200, first.text
        assert second.status_code == 200, second.text
        assert first.json()["snapshotId"] != second.json()["snapshotId"]

        db_session.expire_all()
        active = await db_session.execute(
            select(func.count())
            .select_from(AgentModelSnapshot)
            .where(
                AgentModelSnapshot.owner_user_id == uuid.UUID(user_id),
                AgentModelSnapshot.status == "active",
            )
        )
        assert int(active.scalar_one()) == 1

    @pytest.mark.asyncio
    async def test_read_under_a_probed_at_tie_is_deterministic(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """Two active rows sharing probedAt must resolve by id, not row order.

        The scope carries no unique key, so two racing upload ticks can leave two
        active rows — and a re-sent document carries the SAME probedAt, making the
        tie the common case rather than the exotic one.

        Both insertion orders are covered, and that is what makes the test mean
        something. Which row an un-tie-broken ``ORDER BY probed_at DESC`` returns
        under a tie is plan-dependent: a sequential scan follows heap order (first
        inserted wins) while a backward scan of
        ``ix_agent_model_snapshot_scope`` walks it in reverse (last inserted
        wins). An earlier version of this test fixed ONE insertion order and
        passed against the un-tie-broken query — it asserted nothing. Requiring
        both orders to resolve to the same row cannot be satisfied by any plan
        without a real tie-break.

        The two orders live in two harness scopes (the scope is
        (harness, owner) now), and it asserts the READ (served model list +
        snapshotId), not a row count, because the flip is only ever observable
        to a caller.
        """
        user_id, headers = await authed_user(client)
        owner = uuid.UUID(user_id)
        shared_probed_at = datetime(2026, 7, 24, 9, 12, 3, tzinfo=UTC)

        async def insert(row_id: uuid.UUID, marker: str, harness: str) -> None:
            await db_session.execute(
                text(
                    "INSERT INTO agent_model_snapshot "
                    "(id, harness_kind, owner_user_id, snapshot_json, "
                    "probed_at, status) "
                    "VALUES (:id, :harness, :owner, :payload, :probed_at, 'active')"
                ),
                {
                    "id": row_id,
                    "harness": harness,
                    "owner": owner,
                    "payload": snapshot_document([marker], agent=harness),
                    "probed_at": shared_probed_at,
                },
            )

        # Two scopes, opposite insertion orders, same expected winner: the higher
        # id. "claude" inserts lower-first, "codex" higher-first.
        ascending = sorted([uuid.uuid4(), uuid.uuid4()])
        descending = sorted([uuid.uuid4(), uuid.uuid4()])
        await insert(ascending[0], "lower-id", "claude")
        await insert(ascending[1], "higher-id", "claude")
        await insert(descending[1], "higher-id", "codex")
        await insert(descending[0], "lower-id", "codex")
        await db_session.commit()

        for harness, winner in (("claude", ascending[1]), ("codex", descending[1])):
            response = await client.get(
                f"/v1/cloud/agent-models/{harness}",
                headers=headers,
            )
            assert response.status_code == 200, response.text
            assert model_ids(response.json()) == ["higher-id"], harness
            assert response.json()["snapshotId"] == str(winner), harness

    @pytest.mark.asyncio
    async def test_two_harnesses_upload_independently(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """One harness's upload never retires another harness's active row."""
        user_id, headers = await authed_user(client)
        worker = await cloud_sandbox_worker_headers(
            db_session,
            owner_user_id=uuid.UUID(user_id),
        )
        for harness, models in (("claude", ["claude-m"]), ("codex", ["codex-m"])):
            response = await client.post(
                f"/v1/cloud/agent-models/{harness}/refresh",
                json={
                    "snapshotJson": snapshot_document(models, agent=harness),
                    "probedAt": PROBED_AT,
                },
                headers=worker,
            )
            assert response.status_code == 200, response.text

        claude = await client.get("/v1/cloud/agent-models/claude", headers=headers)
        codex = await client.get("/v1/cloud/agent-models/codex", headers=headers)
        assert model_ids(claude.json()) == ["claude-m"]
        assert model_ids(codex.json()) == ["codex-m"]
