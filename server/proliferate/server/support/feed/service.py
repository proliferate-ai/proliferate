"""Private completed-report feed service.

Exposes only completed reports, ordered by ``(completed_at, id)``, through a
versioned authenticated opaque cursor. It never exposes the report message,
diagnostics, attachments, object keys, signed URLs, account email, or log
bodies. Private case evidence is fetched later through an audited support
boundary.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.store import support_reports
from proliferate.db.store.support_reports import SupportFeedReportRow
from proliferate.server.support.feed.domain.cursor import decode_cursor, encode_cursor
from proliferate.server.support.feed.errors import SupportFeedInvalidCursor
from proliferate.server.support.feed.models import (
    SupportFeedItem,
    SupportFeedPage,
    SupportFeedSentryEvent,
)

DEFAULT_LIMIT = 50
MIN_LIMIT = 1
MAX_LIMIT = 100

_RELEASE_MISSING_WARNING = "client_release_missing"


async def get_support_report_feed(
    *,
    db: AsyncSession,
    cursor: str | None,
    limit: int,
) -> SupportFeedPage:
    bounded_limit = max(MIN_LIMIT, min(MAX_LIMIT, limit))
    secret = _cursor_secret()

    after_completed_at = None
    after_id = None
    if cursor:
        try:
            after_completed_at, after_id = decode_cursor(secret=secret, cursor=cursor)
        except ValueError as exc:
            raise SupportFeedInvalidCursor() from exc

    # Read one extra row to determine hasMore without a second query.
    rows = await support_reports.list_completed_reports_for_feed(
        db,
        after_completed_at=after_completed_at,
        after_id=after_id,
        limit=bounded_limit + 1,
    )
    has_more = len(rows) > bounded_limit
    page_rows = rows[:bounded_limit]

    items = [_feed_item(row, secret=secret) for row in page_rows]
    next_cursor = items[-1].cursor if (has_more and items) else None
    return SupportFeedPage(items=items, next_cursor=next_cursor, has_more=has_more)


def _feed_item(row: SupportFeedReportRow, *, secret: str) -> SupportFeedItem:
    item_cursor = encode_cursor(
        secret=secret,
        completed_at=row.completed_at,
        report_id=row.id,
    )
    return SupportFeedItem(
        reportId=row.id,
        submittedAt=row.created_at,
        completedAt=row.completed_at,
        ownerUserId=str(row.owner_user_id),
        kind=row.kind,
        summary=row.tracker_summary,
        releaseId=row.client_release_id,
        releaseWarning=None if row.client_release_id else _RELEASE_MISSING_WARNING,
        notifyMe=row.notify_me,
        creditConsent=row.credit_consent,
        creditName=row.credit_name if row.credit_consent else None,
        outreachOverride=row.owner_outreach_email,
        privateCaseReference=f"support-report:{row.id}",
        sentryEvents=_sentry_events(row.telemetry_refs),
        cursor=item_cursor,
    )


def _sentry_events(telemetry_refs: dict[str, object]) -> list[SupportFeedSentryEvent]:
    raw = telemetry_refs.get("sentryEvents")
    if not isinstance(raw, list):
        return []
    events: list[SupportFeedSentryEvent] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        project = entry.get("project")
        event_id = entry.get("eventId")
        if isinstance(project, str) and isinstance(event_id, str) and project and event_id:
            events.append(SupportFeedSentryEvent(project=project, eventId=event_id))
    return events


def _cursor_secret() -> str:
    # The cursor is authenticated with a stable server secret so it survives
    # restarts. jwt_secret is always configured in production.
    return settings.jwt_secret
