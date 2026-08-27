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

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

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
