"""Integration tests: sequence/fingerprint delivery governance (slice 3).

Spec §2 "How delivery is governed": the document's ``sequence`` is monotonic
per (user, surface) and bumps ONLY on a render whose ``harnesses`` content
changed — including content changes that touch no selection row (the seat
revoke here is exactly the live bug this slice fixes: under
``max(updated_at)`` derivation, revoking a seat left the served document
byte-identical). ``fingerprint`` is the ``GET /state`` rider hashing the
canonical ``harnesses`` array only; the ack closes the loop and a selection
reads applied only when the ack carries the CURRENT (sequence, fingerprint).
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.db.store import agent_gateway as agent_gateway_store
from tests.integration.test_agent_auth_delivery_ack import (
    _ack_state,
    _list_selections,
    _put_api_key_selection,
)
from tests.integration.test_agent_gateway_api import (
    _authed_user,
    _create_key,
    _get_state,
    _put_selections,
)

SEAT_TOKEN = "sk-ant-oat01-governance-seat-token"


async def _mint_seat(client: AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    minted = await client.post(
        "/v1/cloud/agent-auth/keys",
        headers=headers,
        json={
            "value": SEAT_TOKEN,
            "kind": "anthropic_subscription",
            "email": "ops@acme.com",
            "planTier": "Max 20x",
        },
    )
    assert minted.status_code == 200, minted.text
    return minted.json()


class TestSequenceGovernance:
    @pytest.mark.asyncio
    async def test_revoke_bumps_sequence_because_content_changed(
        self, client: AsyncClient
    ) -> None:
        # The slice's headline fix: a vault mutation that touches NO selection
        # row still changes the rendered content, so the sequence must move.
        # (Live-verified bug under updated_at derivation: revoking a seat left
        # the document identical.) A pool seat selection carries api_key_id
        # NULL, so the seat vault row revokes without a 409 while the
        # selection keeps rendering — the exact decay scenario.
        _, headers = await _authed_user(client)
        seat = await _mint_seat(client, headers)
        put = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[{"sourceKind": "seat"}],
        )
        assert put.status_code == 200, put.text

        first = (await _get_state(client, headers, "local")).json()
        second = (await _get_state(client, headers, "local")).json()
        assert second["sequence"] == first["sequence"]
        assert second["fingerprint"] == first["fingerprint"]

        revoked = await client.delete(
            f"/v1/cloud/agent-auth/keys/{seat['id']}",
            headers=headers,
        )
        assert revoked.status_code == 200, revoked.text

        after = (await _get_state(client, headers, "local")).json()
        assert after["sequence"] == first["sequence"] + 1
        assert after["fingerprint"] != first["fingerprint"]
        # The content change is the seat vanishing: present-but-empty, closed.
        [claude] = [e for e in after["harnesses"] if e["harness_kind"] == "claude"]
        assert claude["sources"] == []

    @pytest.mark.asyncio
    async def test_noop_render_keeps_sequence(self, client: AsyncClient) -> None:
        # "A no-op render changes neither" (spec §2), through the persisted
        # counter: repeated GETs with no mutation serve the same pair.
        _, headers = await _authed_user(client)
        key = await _create_key(client, headers)
        await _put_api_key_selection(
            client,
            headers,
            harness="claude",
            surface="local",
            api_key_id=key["id"],
            env_var_name="ANTHROPIC_API_KEY",
        )
        first = (await _get_state(client, headers, "local")).json()
        second = (await _get_state(client, headers, "local")).json()
        assert (second["sequence"], second["fingerprint"]) == (
            first["sequence"],
            first["fingerprint"],
        )

    @pytest.mark.asyncio
    async def test_ack_above_current_sequence_is_rejected(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        # Only-forward, server-bounded: an ack the server never served is 400
        # and stamps nothing (accepting it would wedge the only-move-forward
        # store against every later legitimate ack).
        user_id, headers = await _authed_user(client)
        key = await _create_key(client, headers)
        await _put_api_key_selection(
            client,
            headers,
            harness="claude",
            surface="local",
            api_key_id=key["id"],
            env_var_name="ANTHROPIC_API_KEY",
        )
        state = (await _get_state(client, headers, "local")).json()

        response = await _ack_state(
            client,
            headers,
            surface="local",
            sequence=state["sequence"] + 1,
            fingerprint=state["fingerprint"],
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_auth_delivery_ack"
        assert (
            await agent_gateway_store.get_delivery_ack(
                db_session, user_id=uuid.UUID(user_id), surface="local"
            )
        ) is None

    @pytest.mark.asyncio
    async def test_equal_sequence_ack_is_idempotent(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        # A re-ack of the served pair is not an error and not a change: equal
        # sequence carries equal content by construction.
        user_id, headers = await _authed_user(client)
        key = await _create_key(client, headers)
        await _put_api_key_selection(
            client,
            headers,
            harness="claude",
            surface="local",
            api_key_id=key["id"],
            env_var_name="ANTHROPIC_API_KEY",
        )
        state = (await _get_state(client, headers, "local")).json()

        first = await _ack_state(
            client,
            headers,
            surface="local",
            sequence=state["sequence"],
            fingerprint=state["fingerprint"],
        )
        assert first.status_code == 200, first.text
        second = await _ack_state(
            client,
            headers,
            surface="local",
            sequence=state["sequence"],
            fingerprint=state["fingerprint"],
        )
        assert second.status_code == 200, second.text
        assert second.json()["ackedSequence"] == state["sequence"]

        record = await agent_gateway_store.get_delivery_ack(
            db_session, user_id=uuid.UUID(user_id), surface="local"
        )
        assert record is not None
        assert (record.acked_sequence, record.acked_fingerprint) == (
            state["sequence"],
            state["fingerprint"],
        )
        assert {r["applied"] for r in await _list_selections(client, headers)} == {True}

    @pytest.mark.asyncio
    async def test_acked_sequence_column_round_trip(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        # The migration's rename, end to end: the store writes through the
        # renamed model column and the raw `acked_sequence` column holds it
        # (the test database is alembic-migrated, never create_all'd).
        user_id, _ = await _authed_user(client)
        uid = uuid.UUID(user_id)
        await agent_gateway_store.record_delivery_ack(
            db_session, user_id=uid, surface="local", sequence=7, fingerprint="fp-7"
        )
        raw = (
            await db_session.execute(
                text(
                    "SELECT acked_sequence FROM agent_auth_delivery_ack "
                    "WHERE user_id = :user_id AND surface = 'local'"
                ),
                {"user_id": uid},
            )
        ).scalar_one()
        assert raw == 7
        record = await agent_gateway_store.get_delivery_ack(
            db_session, user_id=uid, surface="local"
        )
        assert record is not None and record.acked_sequence == 7

    @pytest.mark.asyncio
    async def test_selection_reads_applied_only_when_ack_carries_current_sequence_and_fingerprint(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        # The applied rule, both legs (spec §4 cell 1: "applied = ack carries
        # current (sequence, fingerprint)"): a stamp matching on sequence but
        # not fingerprint reads pending, and a stamp for a superseded
        # document reads pending after the content moves on.
        user_id, headers = await _authed_user(client)
        uid = uuid.UUID(user_id)
        key = await _create_key(client, headers)
        await _put_api_key_selection(
            client,
            headers,
            harness="claude",
            surface="local",
            api_key_id=key["id"],
            env_var_name="ANTHROPIC_API_KEY",
        )
        state = (await _get_state(client, headers, "local")).json()

        # Right sequence, wrong fingerprint (stamped through the store — the
        # route would have echoed the served one): NOT applied.
        await agent_gateway_store.record_delivery_ack(
            db_session,
            user_id=uid,
            surface="local",
            sequence=state["sequence"],
            fingerprint="not-the-served-fingerprint",
        )
        await db_session.commit()
        assert {r["applied"] for r in await _list_selections(client, headers)} == {False}

        # The served pair: applied.
        acked = await _ack_state(
            client,
            headers,
            surface="local",
            sequence=state["sequence"],
            fingerprint=state["fingerprint"],
        )
        assert acked.status_code == 200, acked.text
        assert {r["applied"] for r in await _list_selections(client, headers)} == {True}

        # Content moves on (a real edit): the old stamp no longer carries the
        # current pair, so the surface reads pending again.
        await _put_api_key_selection(
            client,
            headers,
            harness="claude",
            surface="local",
            api_key_id=key["id"],
            env_var_name="ANTHROPIC_AUTH_TOKEN",
        )
        assert {r["applied"] for r in await _list_selections(client, headers)} == {False}


class TestBumpIsOneStatement:
    """The bump's returned sequence always belongs to the fingerprint it stored.

    "Equal sequence means identical content" is what the runtime's
    equal-sequence acceptance and the idempotent re-ack rely on, so the bump is
    ONE statement: an unconditional ON CONFLICT DO UPDATE whose SET decides
    (``CASE WHEN fingerprint IS DISTINCT FROM :fp THEN sequence + 1 ELSE
    sequence END``) and which therefore always returns the row it wrote. No
    second statement re-reads the counter, so no interleaving can pair a
    sequence with a fingerprint it was not stored with.
    """

    @pytest.mark.asyncio
    async def test_unchanged_fingerprint_holds_and_changed_fingerprint_advances(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        user_id, _ = await _authed_user(client)
        uid = uuid.UUID(user_id)

        async def bump(fingerprint: str) -> int:
            sequence, _lineage = await agent_gateway_store.bump_render_sequence_if_changed(
                db_session, user_id=uid, surface="local", fingerprint=fingerprint
            )
            return sequence

        # Insert arm, then the held arm twice, then a real change, then a
        # revert: reverting is still a change, so it advances (the sequence is
        # monotonic, never content-addressed).
        assert await bump("fp-a") == 1
        assert await bump("fp-a") == 1
        assert await bump("fp-a") == 1
        assert await bump("fp-b") == 2
        assert await bump("fp-a") == 3

        row = await agent_gateway_store.get_render_sequence(
            db_session, user_id=uid, surface="local"
        )
        assert row is not None
        assert (row.sequence, row.fingerprint) == (3, "fp-a")

    @pytest.mark.asyncio
    async def test_lineage_is_stable_across_renders_and_reborn_with_the_row(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        # The lineage law, both halves (the founder-ruled wedge close):
        # 1) same row → same uuid, no matter how many renders bump or hold the
        #    sequence — content changes move the SEQUENCE, never the lineage;
        # 2) a recreated row mints a NEW lineage and its counter honestly
        #    restarts at 1 — the DB-rebuild simulation, which is exactly the
        #    signal the runtime's foreign-lineage refusal keys on.
        user_id, _ = await _authed_user(client)
        uid = uuid.UUID(user_id)

        async def bump(fingerprint: str) -> tuple[int, uuid.UUID]:
            return await agent_gateway_store.bump_render_sequence_if_changed(
                db_session, user_id=uid, surface="local", fingerprint=fingerprint
            )

        first_sequence, first_lineage = await bump("fp-a")
        held_sequence, held_lineage = await bump("fp-a")
        moved_sequence, moved_lineage = await bump("fp-b")
        assert (first_sequence, held_sequence, moved_sequence) == (1, 1, 2)
        assert first_lineage == held_lineage == moved_lineage

        # The rebuild: the row is deleted (a dropped/recreated database in
        # miniature) and the next render mints a fresh row.
        await db_session.execute(
            text(
                "DELETE FROM agent_auth_render_sequence "
                "WHERE user_id = :user_id AND surface = 'local'"
            ),
            {"user_id": uid},
        )
        reborn_sequence, reborn_lineage = await bump("fp-b")
        assert reborn_sequence == 1, "a new lineage's counter restarts honestly"
        assert reborn_lineage != first_lineage, "a recreated row is a new lineage"

        row = await agent_gateway_store.get_render_sequence(
            db_session, user_id=uid, surface="local"
        )
        assert row is not None
        assert (row.sequence, row.lineage) == (1, reborn_lineage)

    @pytest.mark.asyncio
    async def test_get_state_serves_a_stable_lineage_beside_the_sequence(
        self, client: AsyncClient
    ) -> None:
        # End to end through the render door: the served document carries the
        # row's lineage, stable across a content change (which bumps only the
        # sequence) — so the runtime's foreign-lineage guard can never fire on
        # an ordinary edit.
        _, headers = await _authed_user(client)
        key = await _create_key(client, headers)
        await _put_api_key_selection(
            client,
            headers,
            harness="claude",
            surface="local",
            api_key_id=key["id"],
            env_var_name="ANTHROPIC_API_KEY",
        )
        first = (await _get_state(client, headers, "local")).json()
        assert uuid.UUID(first["lineage"]), "the document names its lineage"

        await _put_api_key_selection(
            client,
            headers,
            harness="claude",
            surface="local",
            api_key_id=key["id"],
            env_var_name="ANTHROPIC_AUTH_TOKEN",
        )
        after = (await _get_state(client, headers, "local")).json()
        assert after["sequence"] == first["sequence"] + 1
        assert after["lineage"] == first["lineage"], (
            "a content change bumps the sequence, never the lineage"
        )

    @pytest.mark.asyncio
    async def test_held_arm_leaves_rendered_at_untouched(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        # "A no-op render changes neither" (spec §2) reaches the timestamps too:
        # rendered_at names the render that MOVED the row, so the held arm must
        # not restamp it even though the statement now always updates.
        user_id, _ = await _authed_user(client)
        uid = uuid.UUID(user_id)

        async def rendered_at() -> object:
            return (
                await db_session.execute(
                    text(
                        "SELECT rendered_at FROM agent_auth_render_sequence "
                        "WHERE user_id = :user_id AND surface = 'local'"
                    ),
                    {"user_id": uid},
                )
            ).scalar_one()

        await agent_gateway_store.bump_render_sequence_if_changed(
            db_session, user_id=uid, surface="local", fingerprint="fp-a"
        )
        first = await rendered_at()
        await agent_gateway_store.bump_render_sequence_if_changed(
            db_session, user_id=uid, surface="local", fingerprint="fp-a"
        )
        assert await rendered_at() == first

        await agent_gateway_store.bump_render_sequence_if_changed(
            db_session, user_id=uid, surface="local", fingerprint="fp-b"
        )
        assert await rendered_at() != first

    @pytest.mark.asyncio
    async def test_concurrent_renders_never_share_a_sequence(
        self, client: AsyncClient, db_session: AsyncSession, test_engine: object
    ) -> None:
        # Two concurrent renders on one scope, in separate sessions: one
        # re-renders the stored content (the would-be held arm) and one carries
        # changed content. Whichever interleaving wins, the two renders must NOT
        # come back with the same sequence -- that would be two different
        # documents claiming one sequence number, and the runtime would accept
        # the loser's content as the winner's. The persisted row must end up
        # holding the higher sequence together with THAT render's fingerprint.
        # (The two-statement form upheld this too -- ON CONFLICT DO UPDATE locks
        # the conflicting row before evaluating its WHERE, so the re-read could
        # not move. This pins the property so it survives the next rewrite.)
        user_id, _ = await _authed_user(client)
        uid = uuid.UUID(user_id)
        session_factory = async_sessionmaker(test_engine, expire_on_commit=False)  # type: ignore[call-overload]

        async def render(fingerprint: str) -> int:
            async with session_factory() as session:
                sequence, _lineage = await agent_gateway_store.bump_render_sequence_if_changed(
                    session, user_id=uid, surface="local", fingerprint=fingerprint
                )
                await session.commit()
                return sequence

        seeded = await render("fp-seed")

        held, moved = await asyncio.gather(render("fp-seed"), render("fp-moved"))
        assert held != moved
        assert {held, moved} in ({seeded, seeded + 1}, {seeded + 1, seeded + 2})

        row = await agent_gateway_store.get_render_sequence(
            db_session, user_id=uid, surface="local"
        )
        assert row is not None
        assert row.sequence == max(held, moved)
        assert row.fingerprint == ("fp-seed" if held > moved else "fp-moved")


class TestRenderingGetsMustCommit:
    """``GET /state`` and ``GET /selections`` are WRITE endpoints.

    The render bumps the persisted counter, so both plain GETs depend on
    ``get_async_session`` committing (``db/engine.py``). If either ever stops
    committing -- a read replica, a "GETs don't commit" refactor -- the served
    sequence and the persisted counter desynchronise and every legitimate ack
    is rejected as "from the future". These tests fail loudly there instead.
    """

    @pytest.mark.asyncio
    async def test_get_state_commits_the_bumped_sequence_for_an_independent_session(
        self, client: AsyncClient, test_engine: object
    ) -> None:
        user_id, headers = await _authed_user(client)
        key = await _create_key(client, headers)
        await _put_api_key_selection(
            client,
            headers,
            harness="claude",
            surface="local",
            api_key_id=key["id"],
            env_var_name="ANTHROPIC_API_KEY",
        )
        served = (await _get_state(client, headers, "local")).json()

        # A session that shares no transaction with the request: it can only see
        # the counter if the GET's session committed it.
        session_factory = async_sessionmaker(test_engine, expire_on_commit=False)  # type: ignore[call-overload]
        async with session_factory() as session:
            row = await agent_gateway_store.get_render_sequence(
                session, user_id=uuid.UUID(user_id), surface="local"
            )
        assert row is not None
        assert (row.sequence, row.fingerprint) == (served["sequence"], served["fingerprint"])

        # The consequence, end to end: the ack of the served pair is in bounds.
        acked = await _ack_state(
            client,
            headers,
            surface="local",
            sequence=served["sequence"],
            fingerprint=served["fingerprint"],
        )
        assert acked.status_code == 200, acked.text

    @pytest.mark.asyncio
    async def test_list_selections_commits_the_sequence_its_render_bumped(
        self, client: AsyncClient, test_engine: object
    ) -> None:
        # The selections read is the render that DISCOVERS a vault-side change
        # (revoking a pool seat touches no selection row and renders nothing),
        # so its bump is the one most easily lost to a non-committing session.
        user_id, headers = await _authed_user(client)
        seat = await _mint_seat(client, headers)
        put = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[{"sourceKind": "seat"}],
        )
        assert put.status_code == 200, put.text
        served = (await _get_state(client, headers, "local")).json()
        acked = await _ack_state(
            client,
            headers,
            surface="local",
            sequence=served["sequence"],
            fingerprint=served["fingerprint"],
        )
        assert acked.status_code == 200, acked.text

        revoked = await client.delete(f"/v1/cloud/agent-auth/keys/{seat['id']}", headers=headers)
        assert revoked.status_code == 200, revoked.text

        # This GET is the render that moves the counter; it must persist it.
        assert {r["applied"] for r in await _list_selections(client, headers)} == {False}
        session_factory = async_sessionmaker(test_engine, expire_on_commit=False)  # type: ignore[call-overload]
        async with session_factory() as session:
            row = await agent_gateway_store.get_render_sequence(
                session, user_id=uuid.UUID(user_id), surface="local"
            )
        assert row is not None
        assert row.sequence == served["sequence"] + 1

        # And the counter moved exactly once: the next render is a no-op, so
        # GET /state serves the sequence the selections read already persisted.
        after = (await _get_state(client, headers, "local")).json()
        assert after["sequence"] == served["sequence"] + 1
