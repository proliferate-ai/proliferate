"""Integration tests: acknowledged delivery → applied-vs-pending truth (C-2).

Proof C1's server half (agent-auth.md "Applied means acknowledged"): a
selection write reads *pending* on the selections route until the surface's
runtime acknowledges the rendered document — desktop via
``POST /v1/cloud/agent-auth/state/ack`` (the cloud materialization half died
with the sandbox stack, cull part 2) — and *applied* after. The sequence is
the out-of-order backstop (a delayed ack for a superseded document never
moves the stamp backwards); applied requires the ack to carry the surface's
CURRENT rendered (sequence, fingerprint), both equal — surface-level truth
(spec §4 cell 1).
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.db.store import agent_gateway as agent_gateway_store
from tests.integration.test_agent_gateway_api import (
    _authed_user,
    _create_key,
    _get_state,
    _put_selections,
)


async def _list_selections(
    client: AsyncClient,
    headers: dict[str, str],
    *,
    surface: str | None = None,
) -> list[dict[str, Any]]:
    params = {"surface": surface} if surface is not None else None
    response = await client.get(
        "/v1/cloud/agent-auth/selections",
        headers=headers,
        params=params,
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _ack_state(
    client: AsyncClient,
    headers: dict[str, str],
    *,
    surface: str,
    sequence: int,
    fingerprint: str,
):
    return await client.post(
        "/v1/cloud/agent-auth/state/ack",
        headers=headers,
        params={"surface": surface},
        json={"sequence": sequence, "fingerprint": fingerprint},
    )


def _applied_by_harness(records: list[dict[str, Any]]) -> dict[str, set[bool]]:
    by_harness: dict[str, set[bool]] = {}
    for record in records:
        by_harness.setdefault(record["harnessKind"], set()).add(record["applied"])
    return by_harness


async def _put_api_key_selection(
    client: AsyncClient,
    headers: dict[str, str],
    *,
    harness: str,
    surface: str,
    api_key_id: str,
    env_var_name: str,
    enabled: bool = True,
) -> None:
    response = await _put_selections(
        client,
        headers,
        harness=harness,
        surface=surface,
        sources=[
            {
                "sourceKind": "api_key",
                "apiKeyId": api_key_id,
                "envVarName": env_var_name,
                "enabled": enabled,
            }
        ],
    )
    assert response.status_code == 200, response.text


class TestDesktopAckFlipsPendingToApplied:
    @pytest.mark.asyncio
    async def test_selection_write_is_pending_until_ack_then_applied(
        self, client: AsyncClient
    ) -> None:
        # Proof C1 (server truth): pending until the runtime ack, applied
        # after — no path shows applied without an ack.
        _, headers = await _authed_user(client)
        key = await _create_key(client, headers)

        put = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": key["id"],
                    "envVarName": "ANTHROPIC_API_KEY",
                    "enabled": True,
                }
            ],
        )
        assert put.status_code == 200, put.text
        # The PUT response itself already carries the pending truth.
        assert {record["applied"] for record in put.json()} == {False}

        listed = await _list_selections(client, headers)
        assert {record["applied"] for record in listed} == {False}

        state = (await _get_state(client, headers, "local")).json()
        acked = await _ack_state(
            client,
            headers,
            surface="local",
            sequence=state["sequence"],
            fingerprint=state["fingerprint"],
        )
        assert acked.status_code == 200, acked.text
        assert acked.json() == {
            "surface": "local",
            "ackedSequence": state["sequence"],
            "ackedAt": acked.json()["ackedAt"],
        }

        listed = await _list_selections(client, headers)
        assert {record["applied"] for record in listed} == {True}

    @pytest.mark.asyncio
    async def test_clear_to_native_is_pending_until_the_clear_is_acked(
        self, client: AsyncClient
    ) -> None:
        # Native is delivered as a DELETE of the runtime state; the surviving
        # disabled marker row is the visible pending→applied carrier.
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
        state = (await _get_state(client, headers, "local")).json()
        await _ack_state(
            client,
            headers,
            surface="local",
            sequence=state["sequence"],
            fingerprint=state["fingerprint"],
        )

        cleared = await _put_selections(
            client, headers, harness="claude", surface="local", sources=[]
        )
        assert cleared.status_code == 200, cleared.text
        assert {record["applied"] for record in cleared.json()} == {False}

        empty_state = (await _get_state(client, headers, "local")).json()
        assert empty_state["harnesses"] == []
        acked = await _ack_state(
            client,
            headers,
            surface="local",
            sequence=empty_state["sequence"],
            fingerprint=empty_state["fingerprint"],
        )
        assert acked.status_code == 200, acked.text
        listed = await _list_selections(client, headers)
        assert {record["applied"] for record in listed} == {True}

    @pytest.mark.asyncio
    async def test_out_of_order_ack_never_moves_the_stamp_backwards(
        self, client: AsyncClient
    ) -> None:
        # Latest wins: after the newer document is acked, a delayed ack for
        # the superseded one is inert — applied stays applied.
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
        old_state = (await _get_state(client, headers, "local")).json()

        await _put_api_key_selection(
            client,
            headers,
            harness="claude",
            surface="local",
            api_key_id=key["id"],
            env_var_name="ANTHROPIC_AUTH_TOKEN",
        )
        new_state = (await _get_state(client, headers, "local")).json()
        assert new_state["sequence"] > old_state["sequence"]

        acked = await _ack_state(
            client,
            headers,
            surface="local",
            sequence=new_state["sequence"],
            fingerprint=new_state["fingerprint"],
        )
        assert acked.status_code == 200, acked.text
        assert {record["applied"] for record in await _list_selections(client, headers)} == {True}

        # The delayed, out-of-order ack for the OLD document.
        stale = await _ack_state(
            client,
            headers,
            surface="local",
            sequence=old_state["sequence"],
            fingerprint=old_state["fingerprint"],
        )
        assert stale.status_code == 200, stale.text
        assert stale.json()["ackedSequence"] == new_state["sequence"]
        assert {record["applied"] for record in await _list_selections(client, headers)} == {True}

    @pytest.mark.asyncio
    async def test_scoping_a_new_claude_edit_keeps_codex_pending_until_the_ack_lands(
        self, client: AsyncClient
    ) -> None:
        # Surface-level truth (spec §4 cell 1: applied = ack carries the
        # surface's current sequence AND fingerprint): an unacked claude/local
        # edit changes the local document, so EVERY local selection — codex
        # included — reads pending until the new document is acked, then
        # applied. A different surface (claude/cloud) is untouched throughout.
        _, headers = await _authed_user(client)
        key = await _create_key(client, headers)
        await _put_api_key_selection(
            client,
            headers,
            harness="codex",
            surface="local",
            api_key_id=key["id"],
            env_var_name="OPENAI_API_KEY",
        )
        await _put_api_key_selection(
            client,
            headers,
            harness="claude",
            surface="cloud",
            api_key_id=key["id"],
            env_var_name="ANTHROPIC_API_KEY",
        )
        local_state = (await _get_state(client, headers, "local")).json()
        await _ack_state(
            client,
            headers,
            surface="local",
            sequence=local_state["sequence"],
            fingerprint=local_state["fingerprint"],
        )
        cloud_state = (await _get_state(client, headers, "cloud")).json()
        await _ack_state(
            client,
            headers,
            surface="cloud",
            sequence=cloud_state["sequence"],
            fingerprint=cloud_state["fingerprint"],
        )
        assert {record["applied"] for record in await _list_selections(client, headers)} == {True}

        await _put_api_key_selection(
            client,
            headers,
            harness="claude",
            surface="local",
            api_key_id=key["id"],
            env_var_name="ANTHROPIC_API_KEY",
        )

        local = _applied_by_harness(await _list_selections(client, headers, surface="local"))
        assert local["claude"] == {False}
        assert local["codex"] == {False}
        cloud = _applied_by_harness(await _list_selections(client, headers, surface="cloud"))
        assert cloud["claude"] == {True}

        # The ack of the NEW local document flips the whole surface back.
        new_local_state = (await _get_state(client, headers, "local")).json()
        acked = await _ack_state(
            client,
            headers,
            surface="local",
            sequence=new_local_state["sequence"],
            fingerprint=new_local_state["fingerprint"],
        )
        assert acked.status_code == 200, acked.text
        local = _applied_by_harness(await _list_selections(client, headers, surface="local"))
        assert local["claude"] == {True}
        assert local["codex"] == {True}

    @pytest.mark.asyncio
    async def test_future_sequence_ack_is_rejected_and_stamps_nothing(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        # The fingerprint is trusted from the authenticated client by design
        # (it can only misreport its own delivery state), but the sequence is
        # server-bounded: an ack claiming a sequence beyond the surface's
        # current rendered sequence could never have been served, and
        # accepting it would wedge the only-move-forward backstop against
        # every later legitimate ack.
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

        from_the_future = await _ack_state(
            client,
            headers,
            surface="local",
            sequence=state["sequence"] + 1,
            fingerprint=state["fingerprint"],
        )
        assert from_the_future.status_code == 400
        assert from_the_future.json()["detail"]["code"] == "invalid_agent_auth_delivery_ack"
        assert (
            await agent_gateway_store.get_delivery_ack(
                db_session, user_id=uuid.UUID(user_id), surface="local"
            )
        ) is None
        assert {record["applied"] for record in await _list_selections(client, headers)} == {False}

        # The normal flow — echoing the served identity — still acks.
        acked = await _ack_state(
            client,
            headers,
            surface="local",
            sequence=state["sequence"],
            fingerprint=state["fingerprint"],
        )
        assert acked.status_code == 200, acked.text
        assert {record["applied"] for record in await _list_selections(client, headers)} == {True}

    @pytest.mark.asyncio
    async def test_ack_validation_and_auth(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        bad_sequence = await _ack_state(
            client, headers, surface="local", sequence=-1, fingerprint="fp"
        )
        assert bad_sequence.status_code == 400
        assert bad_sequence.json()["detail"]["code"] == "invalid_agent_auth_delivery_ack"

        bad_fingerprint = await _ack_state(
            client, headers, surface="local", sequence=1, fingerprint="   "
        )
        assert bad_fingerprint.status_code == 400

        unauthenticated = await client.post(
            "/v1/cloud/agent-auth/state/ack",
            params={"surface": "local"},
            json={"sequence": 1, "fingerprint": "fp"},
        )
        assert unauthenticated.status_code == 401


class TestDeliveryAckStore:
    @pytest.mark.asyncio
    async def test_lower_sequence_is_inert_equal_sequence_is_idempotent(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        user_id, _ = await _authed_user(client)
        uid = uuid.UUID(user_id)

        first = await agent_gateway_store.record_delivery_ack(
            db_session, user_id=uid, surface="local", sequence=10, fingerprint="fp-10"
        )
        assert (first.acked_sequence, first.acked_fingerprint) == (10, "fp-10")

        stale = await agent_gateway_store.record_delivery_ack(
            db_session, user_id=uid, surface="local", sequence=9, fingerprint="fp-9"
        )
        assert (stale.acked_sequence, stale.acked_fingerprint) == (10, "fp-10")

        # Equal sequence is an idempotent re-ack: equal sequence carries
        # equal content by construction (the sequence bumps exactly when the
        # rendered content changes), so the stamp is simply re-stamped.
        re_acked = await agent_gateway_store.record_delivery_ack(
            db_session, user_id=uid, surface="local", sequence=10, fingerprint="fp-10"
        )
        assert (re_acked.acked_sequence, re_acked.acked_fingerprint) == (10, "fp-10")

        newer = await agent_gateway_store.record_delivery_ack(
            db_session, user_id=uid, surface="local", sequence=11, fingerprint="fp-11"
        )
        assert (newer.acked_sequence, newer.acked_fingerprint) == (11, "fp-11")

        # Surfaces are independent scopes.
        assert (
            await agent_gateway_store.get_delivery_ack(db_session, user_id=uid, surface="cloud")
        ) is None

    @pytest.mark.asyncio
    async def test_concurrent_first_acks_upsert_instead_of_racing_unique_violation(
        self, client: AsyncClient, db_session: AsyncSession, test_engine: object
    ) -> None:
        # Two concurrent FIRST acks for the same (user, surface): a
        # check-then-insert would have both writers see no row and collide on
        # uq_agent_auth_delivery_ack_scope. The upsert lands the loser in the
        # ON CONFLICT arm, where the same only-move-forward predicate applies
        # — whichever interleaving wins the insert, the final stamp is the
        # higher sequence and neither writer errors.
        user_id, _ = await _authed_user(client)
        uid = uuid.UUID(user_id)
        session_factory = async_sessionmaker(test_engine, expire_on_commit=False)  # type: ignore[call-overload]

        async def ack(sequence: int, fingerprint: str) -> None:
            async with session_factory() as session:
                await agent_gateway_store.record_delivery_ack(
                    session,
                    user_id=uid,
                    surface="local",
                    sequence=sequence,
                    fingerprint=fingerprint,
                )
                await session.commit()

        await asyncio.gather(ack(5, "fp-5"), ack(6, "fp-6"))

        final = await agent_gateway_store.get_delivery_ack(
            db_session, user_id=uid, surface="local"
        )
        assert final is not None
        assert (final.acked_sequence, final.acked_fingerprint) == (6, "fp-6")

    @pytest.mark.asyncio
    async def test_unknown_surface_is_rejected(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        user_id, _ = await _authed_user(client)
        with pytest.raises(ValueError, match="Unknown agent auth surface"):
            await agent_gateway_store.record_delivery_ack(
                db_session,
                user_id=uuid.UUID(user_id),
                surface="sandbox",
                sequence=1,
                fingerprint="fp",
            )
