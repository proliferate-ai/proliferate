"""Integration tests for the seat usage probe + meters read (slice 4).

Covers the delivery spec's proof list end to end against the real API and
store: latest-per-seat under multiple samples, the pane-open refresh (with
its freshness floor), probe_failed + backoff on provider errors, revoked
seats leaving the roster, the writer's 30-day prune, and the secret-hygiene
law (the seat token never reaches samples, logs, or responses). The probe's
outbound request is monkeypatched — fixtures are the test basis; no test
talks to Anthropic.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import OAuthAccount
from proliferate.db.store.agent_gateway import seat_usage as seat_usage_store
from proliferate.integrations.anthropic import AnthropicIntegrationError
from proliferate.server.agent_auth import seats as seats_module
from proliferate.server.agent_auth.seats import run_seat_usage_probe_pass
from tests.helpers.desktop_auth import mint_desktop_token_payload
from tests.unit.test_agent_seat_usage_probe import CAPTURE_2026_08_26

SEAT_TOKEN = "sk-ant-oat01-" + "integration-secret-" * 3 + "abcd"


async def _register_and_login(client: AsyncClient, email: str) -> dict[str, str]:
    from proliferate.auth.models import UserCreate
    from proliferate.auth.users import UserManager, get_user_db
    from proliferate.db.engine import get_async_session
    from proliferate.server.organizations.membership_policy import place_new_identity

    user_id: str | None = None
    async for session in get_async_session():
        async for user_db in get_user_db(session):
            manager = UserManager(user_db)
            user = await manager.create(
                UserCreate(
                    email=email,
                    password="unused-oauth-only",
                    display_name="Seat Usage Tester",
                ),
            )
            await place_new_identity(session, user)
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
        state_prefix="seat-usage",
    )
    return {"user_id": user_id, "access_token": str(token_data["access_token"])}


async def _authed_user(client: AsyncClient) -> tuple[str, dict[str, str]]:
    tokens = await _register_and_login(
        client,
        f"seat-usage-{uuid.uuid4().hex[:8]}@example.com",
    )
    return tokens["user_id"], {"Authorization": f"Bearer {tokens['access_token']}"}


async def _mint_seat(
    client: AsyncClient,
    headers: dict[str, str],
    *,
    email: str,
    token: str = SEAT_TOKEN,
) -> str:
    response = await client.post(
        "/v1/cloud/agent-auth/keys",
        headers=headers,
        json={"value": token, "kind": "anthropic_subscription", "email": email},
    )
    assert response.status_code == 200, response.text
    return str(response.json()["id"])


class _FakeProbe:
    """Stands in for integrations.anthropic.probe_subscription_usage."""

    def __init__(
        self,
        status: int = 200,
        headers: dict[str, str] | None = None,
        error: Exception | None = None,
    ) -> None:
        self.status = status
        self.headers = headers if headers is not None else dict(CAPTURE_2026_08_26)
        self.error = error
        self.calls = 0
        self.tokens_seen: list[str] = []

    async def __call__(self, *, oauth_token: str) -> tuple[int, dict[str, str]]:
        self.calls += 1
        self.tokens_seen.append(oauth_token)
        if self.error is not None:
            raise self.error
        return self.status, dict(self.headers)


@pytest.mark.asyncio
class TestSeatUsageApi:
    async def test_latest_per_seat_under_multiple_samples(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        _, headers = await _authed_user(client)
        seat_a = await _mint_seat(client, headers, email="a@example.com")
        seat_b = await _mint_seat(
            client, headers, email="b@example.com", token=SEAT_TOKEN + "B"
        )
        now = datetime.now(tz=UTC)
        for seat_id, older, newer in (
            (seat_a, 0.30, 0.63),
            (seat_b, 0.10, 0.20),
        ):
            await seat_usage_store.insert_seat_usage_sample(
                db_session,
                api_key_id=uuid.UUID(seat_id),
                status="allowed",
                sampled_at=now - timedelta(hours=1),
                util_5h=older,
                util_7d=older,
            )
            await seat_usage_store.insert_seat_usage_sample(
                db_session,
                api_key_id=uuid.UUID(seat_id),
                status="allowed",
                sampled_at=now - timedelta(minutes=5),
                util_5h=newer,
                util_7d=newer / 2,
                binding_window="five_hour",
            )
        await db_session.commit()

        response = await client.get("/v1/cloud/agent-auth/seats/usage", headers=headers)
        assert response.status_code == 200, response.text
        rows = response.json()
        # One latest row per seat (created_at ties make strict order flaky).
        assert {row["apiKeyId"] for row in rows} == {seat_a, seat_b}
        by_seat = {row["apiKeyId"]: row for row in rows}
        assert by_seat[seat_a]["util5h"] == pytest.approx(0.63)
        assert by_seat[seat_a]["bindingWindow"] == "five_hour"
        assert by_seat[seat_b]["util5h"] == pytest.approx(0.20)
        assert by_seat[seat_b]["status"] == "allowed"
        assert by_seat[seat_a]["sampledAt"]  # ISO string present

    async def test_refresh_probes_each_seat_once_and_skips_fresh(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _, headers = await _authed_user(client)
        await _mint_seat(client, headers, email="a@example.com")
        await _mint_seat(client, headers, email="b@example.com", token=SEAT_TOKEN + "B")
        fake = _FakeProbe()
        monkeypatch.setattr(seats_module, "probe_subscription_usage", fake)

        first = await client.post(
            "/v1/cloud/agent-auth/seats/usage/refresh", headers=headers
        )
        assert first.status_code == 200, first.text
        rows = first.json()
        assert len(rows) == 2
        assert fake.calls == 2
        assert all(row["status"] == "allowed" for row in rows)
        assert all(row["util5h"] == pytest.approx(0.63) for row in rows)

        # The freshness floor: an immediate re-open probes nothing new.
        second = await client.post(
            "/v1/cloud/agent-auth/seats/usage/refresh", headers=headers
        )
        assert second.status_code == 200
        assert len(second.json()) == 2
        assert fake.calls == 2

    async def test_provider_error_records_probe_failed_then_backs_off(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _, headers = await _authed_user(client)
        seat_id = await _mint_seat(client, headers, email="a@example.com")
        fake = _FakeProbe(error=AnthropicIntegrationError(status_code=599, message="down"))
        monkeypatch.setattr(seats_module, "probe_subscription_usage", fake)

        first_pass = await run_seat_usage_probe_pass(db_session)
        await db_session.commit()
        assert first_pass.probed == 1
        assert first_pass.failed == 1
        samples = await seat_usage_store.recent_seat_usage_samples(
            db_session, api_key_id=uuid.UUID(seat_id)
        )
        assert [s.status for s in samples] == ["probe_failed"]
        assert samples[0].util_5h is None

        # Immediately due again? No — the failure backoff holds it.
        second_pass = await run_seat_usage_probe_pass(db_session)
        assert second_pass.probed == 0
        assert second_pass.skipped == 1
        assert fake.calls == 1

    async def test_revoked_seats_leave_the_probe_roster(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _, headers = await _authed_user(client)
        seat_id = await _mint_seat(client, headers, email="a@example.com")
        revoked = await client.delete(
            f"/v1/cloud/agent-auth/keys/{seat_id}", headers=headers
        )
        assert revoked.status_code == 200, revoked.text
        fake = _FakeProbe()
        monkeypatch.setattr(seats_module, "probe_subscription_usage", fake)

        result = await run_seat_usage_probe_pass(db_session)
        assert (result.probed, result.failed, result.skipped) == (0, 0, 0)
        assert fake.calls == 0
        # And the meters read shows nothing for a revoked seat.
        response = await client.get("/v1/cloud/agent-auth/seats/usage", headers=headers)
        assert response.json() == []

    async def test_writer_prunes_samples_past_thirty_days(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _, headers = await _authed_user(client)
        seat_id = await _mint_seat(client, headers, email="a@example.com")
        await seat_usage_store.insert_seat_usage_sample(
            db_session,
            api_key_id=uuid.UUID(seat_id),
            status="allowed",
            sampled_at=datetime.now(tz=UTC) - timedelta(days=31),
            util_5h=0.1,
            util_7d=0.1,
        )
        await db_session.commit()
        fake = _FakeProbe()
        monkeypatch.setattr(seats_module, "probe_subscription_usage", fake)

        response = await client.post(
            "/v1/cloud/agent-auth/seats/usage/refresh", headers=headers
        )
        assert response.status_code == 200
        samples = await seat_usage_store.recent_seat_usage_samples(
            db_session, api_key_id=uuid.UUID(seat_id)
        )
        assert len(samples) == 1  # the fresh one; the 31-day row is pruned
        assert samples[0].util_5h == pytest.approx(0.63)

    async def test_mint_intake_refuses_non_printable_ascii(
        self,
        client: AsyncClient,
    ) -> None:
        # A control char or non-ASCII byte in the token would make the probe's
        # HTTP layer reject (and quote) the Authorization header value —
        # UnicodeEncodeError messages carry the offending character. Intake
        # refuses first, so that path is unreachable.
        _, headers = await _authed_user(client)
        for bad in ("\x01", "é"):
            response = await client.post(
                "/v1/cloud/agent-auth/keys",
                headers=headers,
                json={"value": SEAT_TOKEN + bad, "kind": "anthropic_subscription"},
            )
            assert response.status_code == 400, bad
            assert response.json()["detail"]["code"] == "invalid_agent_seat_token"
            assert SEAT_TOKEN not in response.text

    async def test_seat_token_never_reaches_samples_logs_or_responses(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        _, headers = await _authed_user(client)
        seat_id = await _mint_seat(client, headers, email="hygiene@example.com")
        fake = _FakeProbe()
        monkeypatch.setattr(seats_module, "probe_subscription_usage", fake)

        with caplog.at_level("DEBUG"):
            refresh = await client.post(
                "/v1/cloud/agent-auth/seats/usage/refresh", headers=headers
            )
            listed = await client.get(
                "/v1/cloud/agent-auth/seats/usage", headers=headers
            )
        # The probe DID receive the decrypted token (that is its job)…
        assert fake.tokens_seen == [SEAT_TOKEN]
        # …but the token appears in no response, no log line, and no sample.
        assert SEAT_TOKEN not in refresh.text
        assert SEAT_TOKEN not in listed.text
        assert SEAT_TOKEN not in caplog.text
        samples = await seat_usage_store.recent_seat_usage_samples(
            db_session, api_key_id=uuid.UUID(seat_id)
        )
        for sample in samples:
            assert SEAT_TOKEN not in repr(sample)
