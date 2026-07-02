"""Integration tests: per-target agent-auth scoping and inheritance render.

Covers the target axis added by the ssh/personal-target design (§3.1): CRUD
with ?targetId=, the visible-target ownership gate (404 for unknown AND
foreign ids), the local-surface-only rule, the inheritance render (per-target
override wins per (harness, slot); untouched harnesses inherit; zero
overrides is byte-identical to the default document), and document revision
monotonicity across default and override edits.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.targets import CloudTarget
from tests.integration.test_agent_gateway_api import SECRET, _authed_user, _create_key

_SELECTIONS = "/v1/cloud/agent-gateway/route-selections"
_STATE = "/v1/cloud/agent-gateway/state"


async def _create_target(db_session: AsyncSession, *, owner_user_id: str) -> str:
    target = CloudTarget(
        display_name="ssh-box",
        kind="ssh",
        status="online",
        owner_scope="personal",
        owner_user_id=uuid.UUID(owner_user_id),
        created_by_user_id=uuid.UUID(owner_user_id),
    )
    db_session.add(target)
    await db_session.commit()
    return str(target.id)


async def _get_state(
    client: AsyncClient,
    headers: dict[str, str],
    surface: str,
    target_id: str | None = None,
) -> Response:
    params: dict[str, str] = {"surface": surface}
    if target_id is not None:
        params["targetId"] = target_id
    return await client.get(_STATE, headers=headers, params=params)


class TestTargetSelectionCrud:
    @pytest.mark.asyncio
    async def test_target_scoped_upsert_list_clear(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, headers = await _authed_user(client)
        target_id = await _create_target(db_session, owner_user_id=user_id)

        default = await client.put(
            f"{_SELECTIONS}/claude/local",
            headers=headers,
            json={"route": "native"},
        )
        assert default.status_code == 200, default.text
        assert default.json()["targetId"] is None

        override = await client.put(
            f"{_SELECTIONS}/claude/local",
            headers=headers,
            params={"targetId": target_id},
            json={"route": "native"},
        )
        assert override.status_code == 200, override.text
        payload = override.json()
        assert payload["targetId"] == target_id
        assert payload["surface"] == "local"
        assert payload["revision"] == 1
        # The override and the default are distinct rows.
        assert payload["id"] != default.json()["id"]

        # The default list never interleaves target overrides: consumers keep
        # exactly one row per (harness, surface, slot).
        listed = await client.get(_SELECTIONS, headers=headers)
        assert listed.status_code == 200
        assert [entry["targetId"] for entry in listed.json()["selections"]] == [None]

        filtered = await client.get(
            _SELECTIONS,
            headers=headers,
            params={"targetId": target_id},
        )
        assert filtered.status_code == 200
        assert [entry["targetId"] for entry in filtered.json()["selections"]] == [target_id]

        cleared = await client.delete(
            f"{_SELECTIONS}/claude/local",
            headers=headers,
            params={"targetId": target_id},
        )
        assert cleared.status_code == 204

        missing = await client.delete(
            f"{_SELECTIONS}/claude/local",
            headers=headers,
            params={"targetId": target_id},
        )
        assert missing.status_code == 404
        assert missing.json()["detail"]["code"] == "agent_route_selection_not_found"

        # The default row survives an override clear.
        remaining = await client.get(_SELECTIONS, headers=headers)
        assert [entry["targetId"] for entry in remaining.json()["selections"]] == [None]

    @pytest.mark.asyncio
    async def test_idempotent_target_upsert_keeps_revision(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, headers = await _authed_user(client)
        target_id = await _create_target(db_session, owner_user_id=user_id)

        first = await client.put(
            f"{_SELECTIONS}/claude/local",
            headers=headers,
            params={"targetId": target_id},
            json={"route": "native"},
        )
        assert first.status_code == 200, first.text
        assert first.json()["revision"] == 1

        again = await client.put(
            f"{_SELECTIONS}/claude/local",
            headers=headers,
            params={"targetId": target_id},
            json={"route": "native"},
        )
        assert again.status_code == 200
        assert again.json()["revision"] == 1
        assert again.json()["id"] == first.json()["id"]


class TestTargetScopeRejections:
    @pytest.mark.asyncio
    async def test_malformed_target_id_is_400(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        response = await client.put(
            f"{_SELECTIONS}/claude/local",
            headers=headers,
            params={"targetId": "not-a-uuid"},
            json={"route": "native"},
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_cloud_target_id"

    @pytest.mark.asyncio
    async def test_unknown_and_foreign_targets_are_404(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        _, headers = await _authed_user(client)
        other_user_id, _ = await _authed_user(client)
        foreign_target = await _create_target(db_session, owner_user_id=other_user_id)

        for target_id in (str(uuid.uuid4()), foreign_target):
            upsert = await client.put(
                f"{_SELECTIONS}/claude/local",
                headers=headers,
                params={"targetId": target_id},
                json={"route": "native"},
            )
            assert upsert.status_code == 404, upsert.text
            assert upsert.json()["detail"]["code"] == "cloud_target_not_found"

            clear = await client.delete(
                f"{_SELECTIONS}/claude/local",
                headers=headers,
                params={"targetId": target_id},
            )
            assert clear.status_code == 404
            assert clear.json()["detail"]["code"] == "cloud_target_not_found"

            listed = await client.get(
                _SELECTIONS,
                headers=headers,
                params={"targetId": target_id},
            )
            assert listed.status_code == 404
            assert listed.json()["detail"]["code"] == "cloud_target_not_found"

            state = await _get_state(client, headers, "local", target_id)
            assert state.status_code == 404
            assert state.json()["detail"]["code"] == "cloud_target_not_found"

    @pytest.mark.asyncio
    async def test_cloud_surface_with_target_id_is_400(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, headers = await _authed_user(client)
        target_id = await _create_target(db_session, owner_user_id=user_id)

        upsert = await client.put(
            f"{_SELECTIONS}/claude/cloud",
            headers=headers,
            params={"targetId": target_id},
            json={"route": "gateway"},
        )
        assert upsert.status_code == 400
        assert upsert.json()["detail"]["code"] == "invalid_cloud_target_scope"

        clear = await client.delete(
            f"{_SELECTIONS}/claude/cloud",
            headers=headers,
            params={"targetId": target_id},
        )
        assert clear.status_code == 400
        assert clear.json()["detail"]["code"] == "invalid_cloud_target_scope"

        state = await _get_state(client, headers, "cloud", target_id)
        assert state.status_code == 400
        assert state.json()["detail"]["code"] == "invalid_cloud_target_scope"


class TestTargetInheritanceRender:
    @pytest.mark.asyncio
    async def test_zero_overrides_matches_default_document(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, headers = await _authed_user(client)
        target_id = await _create_target(db_session, owner_user_id=user_id)

        # No selections at all: the revision-0 legacy marker on both scopes.
        empty = await _get_state(client, headers, "local", target_id)
        assert empty.status_code == 200, empty.text
        assert empty.json() == {"revision": 0, "user_id": user_id, "selections": []}

        for harness in ("claude", "codex"):
            upserted = await client.put(
                f"{_SELECTIONS}/{harness}/local",
                headers=headers,
                json={"route": "native"},
            )
            assert upserted.status_code == 200, upserted.text

        default_doc = await _get_state(client, headers, "local")
        target_doc = await _get_state(client, headers, "local", target_id)
        assert target_doc.status_code == 200, target_doc.text
        assert target_doc.json() == default_doc.json()

    @pytest.mark.asyncio
    async def test_override_wins_per_slot_and_untouched_harness_inherits(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, headers = await _authed_user(client)
        target_id = await _create_target(db_session, owner_user_id=user_id)
        key = await _create_key(client, headers)

        for harness in ("claude", "codex"):
            upserted = await client.put(
                f"{_SELECTIONS}/{harness}/local",
                headers=headers,
                json={"route": "native"},
            )
            assert upserted.status_code == 200, upserted.text

        override = await client.put(
            f"{_SELECTIONS}/claude/local",
            headers=headers,
            params={"targetId": target_id},
            json={"route": "api_key", "apiKeyId": key["id"]},
        )
        assert override.status_code == 200, override.text

        target_doc = await _get_state(client, headers, "local", target_id)
        assert target_doc.status_code == 200, target_doc.text
        assert target_doc.json()["selections"] == [
            {
                "harness": "claude",
                "route": "api_key",
                "slot": "primary",
                "provider": "anthropic",
                "key": SECRET,
            },
            {"harness": "codex", "route": "native", "slot": "primary"},
        ]

        # The default document never sees the override.
        default_doc = await _get_state(client, headers, "local")
        assert default_doc.json()["selections"] == [
            {"harness": "claude", "route": "native", "slot": "primary"},
            {"harness": "codex", "route": "native", "slot": "primary"},
        ]

        # Deleting the override reverts the target to inherited defaults.
        cleared = await client.delete(
            f"{_SELECTIONS}/claude/local",
            headers=headers,
            params={"targetId": target_id},
        )
        assert cleared.status_code == 204
        reverted = await _get_state(client, headers, "local", target_id)
        assert reverted.json()["selections"] == default_doc.json()["selections"]

    @pytest.mark.asyncio
    async def test_override_delete_never_lowers_document_revision(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """Reverting to inherited defaults strictly supersedes the pushed doc.

        The runtime rejects pushes below its persisted revision, so if
        deleting an override that carried the strict-max revision lowered the
        rendered max, the revert would be permanently unpushable and the
        runtime would keep the deleted credentials.
        """
        user_id, headers = await _authed_user(client)
        target_id = await _create_target(db_session, owner_user_id=user_id)
        key = await _create_key(client, headers)

        default = await client.put(
            f"{_SELECTIONS}/claude/local",
            headers=headers,
            json={"route": "native"},
        )
        assert default.status_code == 200, default.text

        # Edit the override twice so it strictly out-revisions the default row.
        for body in (
            {"route": "native"},
            {"route": "api_key", "apiKeyId": key["id"]},
            {"route": "native"},
        ):
            override = await client.put(
                f"{_SELECTIONS}/claude/local",
                headers=headers,
                params={"targetId": target_id},
                json=body,
            )
            assert override.status_code == 200, override.text
        assert override.json()["revision"] == 3

        pushed = await _get_state(client, headers, "local", target_id)
        assert pushed.json()["revision"] == 3

        cleared = await client.delete(
            f"{_SELECTIONS}/claude/local",
            headers=headers,
            params={"targetId": target_id},
        )
        assert cleared.status_code == 204

        default_doc = await _get_state(client, headers, "local")
        reverted = await _get_state(client, headers, "local", target_id)
        assert reverted.json()["selections"] == default_doc.json()["selections"]
        assert reverted.json()["selections"] == [
            {"harness": "claude", "route": "native", "slot": "primary"},
        ]
        # The shadowed default row was bumped past the deleted revision.
        assert reverted.json()["revision"] == 4

    @pytest.mark.asyncio
    async def test_target_only_override_delete_bumps_a_surviving_basis_row(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """No shadowed default for the deleted slot: another basis row carries it."""
        user_id, headers = await _authed_user(client)
        target_id = await _create_target(db_session, owner_user_id=user_id)
        key = await _create_key(client, headers)

        codex_default = await client.put(
            f"{_SELECTIONS}/codex/local",
            headers=headers,
            json={"route": "native"},
        )
        assert codex_default.status_code == 200, codex_default.text

        for body in ({"route": "native"}, {"route": "api_key", "apiKeyId": key["id"]}):
            override = await client.put(
                f"{_SELECTIONS}/claude/local",
                headers=headers,
                params={"targetId": target_id},
                json=body,
            )
            assert override.status_code == 200, override.text
        assert override.json()["revision"] == 2

        cleared = await client.delete(
            f"{_SELECTIONS}/claude/local",
            headers=headers,
            params={"targetId": target_id},
        )
        assert cleared.status_code == 204

        reverted = await _get_state(client, headers, "local", target_id)
        assert reverted.json()["selections"] == [
            {"harness": "codex", "route": "native", "slot": "primary"},
        ]
        assert reverted.json()["revision"] == 3

    @pytest.mark.asyncio
    async def test_revision_is_monotonic_across_default_and_override_edits(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, headers = await _authed_user(client)
        target_id = await _create_target(db_session, owner_user_id=user_id)
        key = await _create_key(client, headers)

        async def target_revision() -> int:
            response = await _get_state(client, headers, "local", target_id)
            assert response.status_code == 200, response.text
            return int(response.json()["revision"])

        revisions: list[int] = []

        native = await client.put(
            f"{_SELECTIONS}/claude/local",
            headers=headers,
            json={"route": "native"},
        )
        assert native.status_code == 200, native.text
        revisions.append(await target_revision())

        # Default edit (native -> api_key) bumps the default row to rev 2.
        default_edit = await client.put(
            f"{_SELECTIONS}/claude/local",
            headers=headers,
            json={"route": "api_key", "apiKeyId": key["id"]},
        )
        assert default_edit.status_code == 200
        assert default_edit.json()["revision"] == 2
        revisions.append(await target_revision())

        # A fresh override starts at rev 1 but must not lower the document
        # revision below the already-pushed default document's revision.
        override = await client.put(
            f"{_SELECTIONS}/claude/local",
            headers=headers,
            params={"targetId": target_id},
            json={"route": "native"},
        )
        assert override.status_code == 200
        assert override.json()["revision"] == 1
        revisions.append(await target_revision())

        # Another default edit still advances the target document even though
        # the default row is fully shadowed by the override.
        shadowed_edit = await client.put(
            f"{_SELECTIONS}/claude/local",
            headers=headers,
            json={"route": "native"},
        )
        assert shadowed_edit.status_code == 200
        assert shadowed_edit.json()["revision"] == 3
        revisions.append(await target_revision())

        assert revisions == [1, 2, 2, 3]
        assert revisions == sorted(revisions)

    @pytest.mark.asyncio
    async def test_target_rows_do_not_leak_across_targets_or_surfaces(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, headers = await _authed_user(client)
        target_a = await _create_target(db_session, owner_user_id=user_id)
        target_b = await _create_target(db_session, owner_user_id=user_id)

        override = await client.put(
            f"{_SELECTIONS}/claude/local",
            headers=headers,
            params={"targetId": target_a},
            json={"route": "native"},
        )
        assert override.status_code == 200, override.text

        # No defaults exist: only target A renders a document.
        doc_a = await _get_state(client, headers, "local", target_a)
        assert doc_a.json()["selections"] == [
            {"harness": "claude", "route": "native", "slot": "primary"},
        ]
        doc_b = await _get_state(client, headers, "local", target_b)
        assert doc_b.json() == {"revision": 0, "user_id": user_id, "selections": []}
        default_doc = await _get_state(client, headers, "local")
        assert default_doc.json() == {"revision": 0, "user_id": user_id, "selections": []}
        cloud_doc = await _get_state(client, headers, "cloud")
        assert cloud_doc.json() == {"revision": 0, "user_id": user_id, "selections": []}
