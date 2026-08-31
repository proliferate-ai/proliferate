"""Integration tests for the seat limit-hit relay (slice 2, spec §3 flow 5).

``POST /v1/cloud/agent-auth/seats/{key_id}/limit-hit`` is the courier's
fire-and-forget report of a runtime-observed limit error: 204 with no body,
feeding the audit events only (cooling and the rotation decision stay
runtime-local; the server never picks the next seat).

Lives in its own module because ``test_agent_gateway_api.py`` sits at its
recorded line-count ratchet; shares that module's builders so the surface is
exercised exactly as its sibling routes are. Event capture attaches a
dedicated handler to the leaf ``proliferate.cloud`` logger (the
``sign_in_log_records`` pattern in conftest) because ``caplog``'s root-logger
capture races ``configure_server_logging``'s ``propagate=False``.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Generator

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import agent_gateway as agent_gateway_store
from tests.integration.test_agent_gateway_api import (
    SEAT_TOKEN,
    _authed_user,
    _create_key,
    _org_enrollment_row,
)

RESET_AT_WIRE = "2027-01-02T18:30:00Z"
RESET_AT_ISO = "2027-01-02T18:30:00+00:00"


@pytest.fixture
def cloud_event_records() -> Generator[list[logging.LogRecord], None, None]:
    records: list[logging.LogRecord] = []

    class _RecordCollector(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record)

    logger = logging.getLogger("proliferate.cloud")
    handler = _RecordCollector(level=logging.INFO)
    logger.addHandler(handler)
    try:
        yield records
    finally:
        logger.removeHandler(handler)


def _events(records: list[logging.LogRecord], name: str) -> list[logging.LogRecord]:
    return [record for record in records if record.getMessage().startswith(name)]


async def _mint_seat(client: AsyncClient, headers: dict[str, str], *, token: str) -> str:
    response = await client.post(
        "/v1/cloud/agent-auth/keys",
        headers=headers,
        json={"value": token, "kind": "anthropic_subscription"},
    )
    assert response.status_code == 200, response.text
    return str(response.json()["id"])


async def _report_limit_hit(
    client: AsyncClient,
    headers: dict[str, str],
    key_id: str,
    *,
    window: str | None = "five_hour",
):
    return await client.post(
        f"/v1/cloud/agent-auth/seats/{key_id}/limit-hit",
        headers=headers,
        json={"window": window, "resetAt": RESET_AT_WIRE},
    )


class TestSeatLimitHit:
    @pytest.mark.asyncio
    async def test_seat_limit_hit_returns_204_and_logs_events(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        cloud_event_records: list[logging.LogRecord],
    ) -> None:
        user_id, headers = await _authed_user(client)
        org_id, _ = await _org_enrollment_row(db_session, user_id)
        await db_session.commit()
        hit_seat = await _mint_seat(client, headers, token=SEAT_TOKEN)
        # A second ACTIVE seat is what makes rotation follow — the event
        # carries the seat rotated AWAY FROM plus the server's expectation
        # from the pool it supplies; the runtime owns the actual pick.
        next_seat = await _mint_seat(client, headers, token=SEAT_TOKEN + "B")

        response = await _report_limit_hit(client, headers, hit_seat)
        assert response.status_code == 204, response.text
        assert response.content == b""

        (hit,) = _events(cloud_event_records, "agent_seat_limit_hit")
        assert hit.user_id == user_id  # type: ignore[attr-defined]
        assert hit.api_key_id == hit_seat  # type: ignore[attr-defined]
        assert hit.organization_id == str(org_id)  # type: ignore[attr-defined]
        assert hit.harness_kind == "claude"  # type: ignore[attr-defined]
        assert hit.window == "five_hour"  # type: ignore[attr-defined]
        assert hit.reset_at == RESET_AT_ISO  # type: ignore[attr-defined]

        (rotated,) = _events(cloud_event_records, "agent_seat_rotated")
        assert rotated.user_id == user_id  # type: ignore[attr-defined]
        assert rotated.api_key_id == hit_seat  # type: ignore[attr-defined]
        assert rotated.organization_id == str(org_id)  # type: ignore[attr-defined]
        assert rotated.harness_kind == "claude"  # type: ignore[attr-defined]
        # The prediction: the vault-next active seat, marked as such.
        assert rotated.expected_next_seat_id == next_seat  # type: ignore[attr-defined]
        assert rotated.basis == "expected_from_pool"  # type: ignore[attr-defined]

        # Events carry ids only — never token material.
        for record in cloud_event_records:
            assert SEAT_TOKEN not in record.getMessage()

    @pytest.mark.asyncio
    async def test_expected_next_seat_wraps_the_vault_order(
        self,
        client: AsyncClient,
        cloud_event_records: list[logging.LogRecord],
    ) -> None:
        _, headers = await _authed_user(client)
        first_seat = await _mint_seat(client, headers, token=SEAT_TOKEN)
        last_seat = await _mint_seat(client, headers, token=SEAT_TOKEN + "B")

        # Hitting the LAST seat in vault order wraps: the expectation is the
        # pool's first seat, matching the runtime's cyclic round-robin.
        response = await _report_limit_hit(client, headers, last_seat)
        assert response.status_code == 204, response.text

        (rotated,) = _events(cloud_event_records, "agent_seat_rotated")
        assert rotated.api_key_id == last_seat  # type: ignore[attr-defined]
        assert rotated.expected_next_seat_id == first_seat  # type: ignore[attr-defined]
        assert rotated.basis == "expected_from_pool"  # type: ignore[attr-defined]

    @pytest.mark.asyncio
    async def test_rotate_off_logs_no_rotation_event(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        cloud_event_records: list[logging.LogRecord],
    ) -> None:
        user_id, headers = await _authed_user(client)
        hit_seat = await _mint_seat(client, headers, token=SEAT_TOKEN)
        await _mint_seat(client, headers, token=SEAT_TOKEN + "B")
        # Rotate off pins the applied seat: the runtime will wait for the
        # reset, so the server must not predict a rotation that cannot happen.
        await agent_gateway_store.put_harness_settings(
            db_session,
            user_id=uuid.UUID(user_id),
            harness_kind="claude",
            surface="local",
            settings={"rotate": False},
        )
        await db_session.commit()

        response = await _report_limit_hit(client, headers, hit_seat)
        assert response.status_code == 204, response.text

        (hit,) = _events(cloud_event_records, "agent_seat_limit_hit")
        assert hit.api_key_id == hit_seat  # type: ignore[attr-defined]
        assert _events(cloud_event_records, "agent_seat_rotated") == []

    @pytest.mark.asyncio
    async def test_seat_limit_hit_without_another_seat_logs_no_rotation_event(
        self,
        client: AsyncClient,
        cloud_event_records: list[logging.LogRecord],
    ) -> None:
        _, headers = await _authed_user(client)
        only_seat = await _mint_seat(client, headers, token=SEAT_TOKEN)
        # A revoked sibling is NOT rotation material: only another ACTIVE
        # anthropic_subscription entry means the runtime has somewhere to go.
        revoked = await _mint_seat(client, headers, token=SEAT_TOKEN + "B")
        revoke = await client.delete(
            f"/v1/cloud/agent-auth/keys/{revoked}",
            headers=headers,
        )
        assert revoke.status_code == 200, revoke.text

        response = await _report_limit_hit(client, headers, only_seat, window=None)
        assert response.status_code == 204, response.text

        (hit,) = _events(cloud_event_records, "agent_seat_limit_hit")
        assert hit.api_key_id == only_seat  # type: ignore[attr-defined]
        # window was null: log_cloud_event drops None fields entirely.
        assert not hasattr(hit, "window")
        assert hit.reset_at == RESET_AT_ISO  # type: ignore[attr-defined]
        assert _events(cloud_event_records, "agent_seat_rotated") == []

    @pytest.mark.asyncio
    async def test_seat_limit_hit_on_a_foreign_or_non_seat_key_is_404(
        self,
        client: AsyncClient,
        cloud_event_records: list[logging.LogRecord],
    ) -> None:
        _, headers = await _authed_user(client)
        _, foreign_headers = await _authed_user(client)
        seat = await _mint_seat(client, headers, token=SEAT_TOKEN)
        bare_key = await _create_key(client, headers)

        # Someone else's seat.
        foreign = await _report_limit_hit(client, foreign_headers, seat)
        assert foreign.status_code == 404
        assert foreign.json()["detail"]["code"] == "agent_api_key_not_found"

        # The caller's own key, but not a seat.
        non_seat = await _report_limit_hit(client, headers, str(bare_key["id"]))
        assert non_seat.status_code == 404
        assert non_seat.json()["detail"]["code"] == "agent_api_key_not_found"

        # A key that does not exist at all.
        vanished = await _report_limit_hit(client, headers, str(uuid.uuid4()))
        assert vanished.status_code == 404
        assert vanished.json()["detail"]["code"] == "agent_api_key_not_found"

        assert _events(cloud_event_records, "agent_seat_limit_hit") == []
        assert _events(cloud_event_records, "agent_seat_rotated") == []
