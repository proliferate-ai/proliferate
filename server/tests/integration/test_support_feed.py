"""Integration tests for the private completed-report support feed.

Proves the running feed's fail-closed auth, privacy shape, pagination, and
cursor behavior. The companion ``_deploy-server.yml`` task-render contract
(exactly one ECS feed secret; fail closed on a missing/duplicated/plaintext
reference) lives in ``test_support_feed_deploy_render.py``, split out solely
for the repo-shape 600-line source cap.
"""

from __future__ import annotations

import hmac
import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.auth import User
from proliferate.db.models.support import SupportReport
from proliferate.server.support.feed import access as feed_access

_FEED_PATH = "/internal/support/reports"
_FEED_TOKEN = "test-support-feed-token"
_ACCOUNT_EMAIL_SENTINEL = "private-account@example.com"

# The exact serialized keys the private feed item may expose (see the frozen
# contract). outreachOverride is the sole private outreach field admitted here.
_APPROVED_ITEM_KEYS = {
    "reportId",
    "submittedAt",
    "completedAt",
    "ownerUserId",
    "kind",
    "summary",
    "releaseId",
    "releaseWarning",
    "notifyMe",
    "creditConsent",
    "creditName",
    "outreachOverride",
    "privateCaseReference",
    "sentryEvents",
    "cursor",
}


@pytest.fixture(autouse=True)
def _configure_feed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "support_feed_bearer_token", _FEED_TOKEN)
    monkeypatch.setattr(settings, "jwt_secret", "feed-cursor-secret")


async def _make_user(db: AsyncSession, *, outreach_email: str | None = None) -> User:
    user = User(
        id=uuid4(),
        email=f"{uuid4().hex}-{_ACCOUNT_EMAIL_SENTINEL}",
        hashed_password="x",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        outreach_email=outreach_email,
    )
    db.add(user)
    await db.flush()
    return user


async def _make_completed_report(
    db: AsyncSession,
    *,
    owner: User,
    completed_at: datetime,
    report_id: str | None = None,
    kind: str = "bug",
    tracker_summary: str | None = "Prod is down.",
    client_release_id: str | None = "proliferate-web@0.3.26+9affc0f0d489",
    notify_me: bool = False,
    credit_consent: bool = False,
    credit_name: str | None = None,
    telemetry_refs: dict[str, object] | None = None,
) -> str:
    rid = report_id or uuid4().hex
    db.add(
        SupportReport(
            id=rid,
            client_job_id=uuid4().hex,
            owner_user_id=owner.id,
            primary_tenant_id=f"user:{owner.id}",
            status="completed",
            s3_bucket="private-support-bucket",
            s3_prefix=f"support/reports/{rid}",
            kind=kind,
            notify_me=notify_me,
            credit_consent=credit_consent,
            credit_name=credit_name,
            client_release_id=client_release_id,
            tracker_summary=tracker_summary,
            telemetry_refs_json=json.dumps(telemetry_refs or {}),
            created_at=completed_at - timedelta(minutes=5),
            updated_at=completed_at,
            completed_at=completed_at,
        )
    )
    await db.flush()
    return rid


def _auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {_FEED_TOKEN}"}


async def test_feed_rejects_missing_and_wrong_key(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _make_user(db_session)
    await _make_completed_report(
        db_session, owner=owner, completed_at=datetime(2026, 7, 1, tzinfo=UTC)
    )
    await db_session.commit()

    assert (await client.get(_FEED_PATH)).status_code == 401
    assert (
        await client.get(_FEED_PATH, headers={"Authorization": "Bearer wrong"})
    ).status_code == 401
    assert (await client.get(_FEED_PATH, headers=_auth())).status_code == 200


async def test_feed_unset_key_rejects_every_request(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "support_feed_bearer_token", "")
    # Even the empty string presented as a token must not authenticate.
    assert (await client.get(_FEED_PATH, headers={"Authorization": "Bearer "})).status_code == 401
    assert (await client.get(_FEED_PATH, headers=_auth())).status_code == 401


async def test_feed_auth_matrix_is_fail_closed(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """The full credential matrix from the frozen contract stays fail closed."""

    owner = await _make_user(db_session)
    await _make_completed_report(
        db_session, owner=owner, completed_at=datetime(2026, 7, 1, tzinfo=UTC)
    )
    await db_session.commit()

    # missing Authorization header
    assert (await client.get(_FEED_PATH)).status_code == 401
    # wrong scheme
    assert (
        await client.get(_FEED_PATH, headers={"Authorization": f"Basic {_FEED_TOKEN}"})
    ).status_code == 401
    # bearer with no token (empty after the scheme)
    assert (await client.get(_FEED_PATH, headers={"Authorization": "Bearer "})).status_code == 401
    # malformed: token that is a prefix of the configured token
    assert (
        await client.get(_FEED_PATH, headers={"Authorization": f"Bearer {_FEED_TOKEN[:-1]}"})
    ).status_code == 401
    # wrong token entirely (stands in for a cross-environment token)
    assert (
        await client.get(_FEED_PATH, headers={"Authorization": "Bearer not-the-token"})
    ).status_code == 401
    # correct environment token
    ok = await client.get(_FEED_PATH, headers=_auth())
    assert ok.status_code == 200
    assert ok.json()["items"]


async def test_feed_auth_boundary_uses_constant_time_compare(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The presented/configured comparison must go through hmac.compare_digest."""

    calls: list[tuple[str, str]] = []
    real_compare = hmac.compare_digest

    def _spy(a: object, b: object) -> bool:
        calls.append((str(a), str(b)))
        return real_compare(a, b)  # type: ignore[arg-type]

    monkeypatch.setattr(feed_access.hmac, "compare_digest", _spy)

    # A well-formed but wrong token reaches the constant-time comparison.
    resp = await client.get(_FEED_PATH, headers={"Authorization": "Bearer wrong-but-shaped"})
    assert resp.status_code == 401
    assert calls, "require_support_feed_key must compare via hmac.compare_digest"
    assert calls[-1] == ("wrong-but-shaped", _FEED_TOKEN)


async def test_feed_item_exposes_exactly_the_approved_keys(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _make_user(db_session, outreach_email="override@example.com")
    await _make_completed_report(
        db_session, owner=owner, completed_at=datetime(2026, 7, 2, 9, 0, tzinfo=UTC)
    )
    await db_session.commit()

    payload = (await client.get(_FEED_PATH, headers=_auth())).json()
    (item,) = payload["items"]
    assert set(item.keys()) == _APPROVED_ITEM_KEYS
    # outreachOverride is admitted; it is the only private outreach field.
    assert "outreachOverride" in item
    # The page envelope is the bounded completed-report page shape.
    assert set(payload.keys()) == {"items", "nextCursor", "hasMore"}


async def test_feed_item_is_privacy_safe(client: AsyncClient, db_session: AsyncSession) -> None:
    owner = await _make_user(db_session, outreach_email="override@example.com")
    rid = await _make_completed_report(
        db_session,
        owner=owner,
        completed_at=datetime(2026, 7, 2, 9, 0, tzinfo=UTC),
        kind="feature",
        tracker_summary="App crashed on launch.",
        notify_me=True,
        credit_consent=True,
        credit_name="Ada Lovelace",
        telemetry_refs={
            "sentryEvents": [{"project": "proliferate-web", "eventId": "evt_1"}],
            "sentryEventIds": ["bare_id"],
            "posthogDistinctId": "distinct_1",
        },
    )
    await db_session.commit()

    response = await client.get(_FEED_PATH, headers=_auth())
    assert response.status_code == 200
    payload = response.json()
    assert payload["hasMore"] is False
    (item,) = payload["items"]

    assert item["reportId"] == rid
    assert item["kind"] == "feature"
    assert item["summary"] == "App crashed on launch."
    assert item["releaseId"] == "proliferate-web@0.3.26+9affc0f0d489"
    assert item["releaseWarning"] is None
    assert item["notifyMe"] is True
    assert item["creditConsent"] is True
    assert item["creditName"] == "Ada Lovelace"
    assert item["outreachOverride"] == "override@example.com"
    assert item["privateCaseReference"] == f"support-report:{rid}"
    assert item["sentryEvents"] == [{"project": "proliferate-web", "eventId": "evt_1"}]
    assert isinstance(item["cursor"], str) and item["cursor"]

    # Nothing private may leak anywhere in the serialized payload.
    raw = response.text
    for forbidden in (
        _ACCOUNT_EMAIL_SENTINEL,
        owner.email,
        "private-support-bucket",
        "support/reports/",
        "distinct_1",
        "bare_id",
        "hashed_password",
        "request.json",
    ):
        assert forbidden not in raw, forbidden


async def test_feed_legacy_null_release_has_warning(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _make_user(db_session)
    await _make_completed_report(
        db_session,
        owner=owner,
        completed_at=datetime(2026, 7, 3, tzinfo=UTC),
        client_release_id=None,
    )
    await db_session.commit()

    payload = (await client.get(_FEED_PATH, headers=_auth())).json()
    (item,) = payload["items"]
    assert item["releaseId"] is None
    assert item["releaseWarning"] == "client_release_missing"


async def test_feed_same_timestamp_pagination_no_skip_or_dupe(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _make_user(db_session)
    shared = datetime(2026, 7, 4, 12, 0, 0, tzinfo=UTC)
    ids = sorted(uuid4().hex for _ in range(5))
    for rid in ids:
        await _make_completed_report(db_session, owner=owner, completed_at=shared, report_id=rid)
    await db_session.commit()

    collected: list[str] = []
    cursor: str | None = None
    for _ in range(10):
        params = {"limit": "2"}
        if cursor:
            params["cursor"] = cursor
        payload = (await client.get(_FEED_PATH, headers=_auth(), params=params)).json()
        collected.extend(entry["reportId"] for entry in payload["items"])
        if not payload["hasMore"]:
            break
        cursor = payload["nextCursor"]
        assert cursor is not None

    assert collected == ids  # ordered by id under the shared timestamp; no gaps/dupes


async def test_feed_full_pagination_count_parity(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _make_user(db_session)
    base = datetime(2026, 7, 5, tzinfo=UTC)
    expected = set()
    for offset in range(7):
        expected.add(
            await _make_completed_report(
                db_session, owner=owner, completed_at=base + timedelta(minutes=offset)
            )
        )
    # A non-completed report must never appear in the feed.
    db_session.add(
        SupportReport(
            id="uploading_report",
            client_job_id=uuid4().hex,
            owner_user_id=owner.id,
            primary_tenant_id=f"user:{owner.id}",
            status="uploading",
            s3_bucket="b",
            s3_prefix="p",
        )
    )
    await db_session.commit()

    seen: list[str] = []
    cursor: str | None = None
    for _ in range(20):
        params = {"limit": "3"}
        if cursor:
            params["cursor"] = cursor
        payload = (await client.get(_FEED_PATH, headers=_auth(), params=params)).json()
        seen.extend(entry["reportId"] for entry in payload["items"])
        if not payload["hasMore"]:
            break
        cursor = payload["nextCursor"]

    assert set(seen) == expected
    assert len(seen) == len(expected)
    assert "uploading_report" not in seen


async def test_feed_cursor_replay_is_deterministic(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _make_user(db_session)
    base = datetime(2026, 7, 6, tzinfo=UTC)
    for offset in range(4):
        await _make_completed_report(
            db_session, owner=owner, completed_at=base + timedelta(minutes=offset)
        )
    await db_session.commit()

    first = (await client.get(_FEED_PATH, headers=_auth(), params={"limit": "2"})).json()
    cursor = first["items"][-1]["cursor"]

    a = await client.get(_FEED_PATH, headers=_auth(), params={"cursor": cursor, "limit": "2"})
    b = await client.get(_FEED_PATH, headers=_auth(), params={"cursor": cursor, "limit": "2"})
    assert a.status_code == 200 and b.status_code == 200
    assert a.text == b.text


async def test_feed_rejects_tampered_cursor(client: AsyncClient, db_session: AsyncSession) -> None:
    owner = await _make_user(db_session)
    await _make_completed_report(
        db_session, owner=owner, completed_at=datetime(2026, 7, 7, tzinfo=UTC)
    )
    await db_session.commit()

    response = await client.get(
        _FEED_PATH, headers=_auth(), params={"cursor": "v1.tampered.signature"}
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "support_feed_invalid_cursor"


async def test_feed_limit_bounds_enforced(client: AsyncClient, db_session: AsyncSession) -> None:
    owner = await _make_user(db_session)
    await _make_completed_report(
        db_session, owner=owner, completed_at=datetime(2026, 7, 8, tzinfo=UTC)
    )
    await db_session.commit()

    too_low = await client.get(_FEED_PATH, headers=_auth(), params={"limit": "0"})
    too_high = await client.get(_FEED_PATH, headers=_auth(), params={"limit": "101"})
    assert too_low.status_code == 422
    assert too_high.status_code == 422
