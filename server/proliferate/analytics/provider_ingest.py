"""Provider-cost/usage ingestion job for the ``analytics`` Postgres schema.

Pulls daily revenue/cost/error data from Stripe, AWS Cost Explorer, E2B, and
Sentry and upserts it into the base tables created by alembic revision
``15649bf2cf24`` (``analytics.stripe_revenue_daily``,
``analytics.stripe_mrr_snapshot``, ``analytics.aws_cost_daily``,
``analytics.e2b_cost_daily``, ``analytics.sentry_errors_daily``). Metabase
reads those tables (and the views built on top of them) through the
read-only ``metabase_readonly`` Postgres role.

Run as a scheduled job::

    python -m proliferate.analytics.provider_ingest

Each provider is fetched and upserted independently; a failure in one
provider is logged and does not prevent the others from running. See
``specs/tbd/dashboards-analytics-ingestion.md`` for the operational design
(secrets, scheduling, etc).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import urllib.parse
from collections import defaultdict
from collections.abc import Awaitable
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from proliferate.config import settings
from proliferate.db.engine import engine

logger = logging.getLogger(__name__)

STRIPE_API_BASE = "https://api.stripe.com/v1"
STRIPE_TIMEOUT_SECONDS = 30.0
STRIPE_LOOKBACK_DAYS = 90

E2B_API_BASE = "https://e2b.dev/api/trpc/billing.getUsage"
DEFAULT_E2B_TEAM_SLUG = "pablo-5391"

SENTRY_API_BASE = "https://sentry.io/api/0"

AWS_COST_LOOKBACK_DAYS = 90
AWS_REGION = "us-east-1"


def _utc_date(dt: datetime) -> date:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).date()


# ---------------------------------------------------------------------------
# Stripe: daily revenue + MRR snapshot
# ---------------------------------------------------------------------------


async def _stripe_request(
    client: httpx.AsyncClient,
    path: str,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    response = await client.get(
        f"{STRIPE_API_BASE}{path}",
        params=params,
        headers={"Authorization": f"Bearer {settings.stripe_secret_key}"},
        timeout=STRIPE_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()


async def _stripe_list_all(
    client: httpx.AsyncClient,
    path: str,
    params: dict[str, Any],
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    starting_after: str | None = None
    while True:
        page_params = dict(params)
        if starting_after:
            page_params["starting_after"] = starting_after
        payload = await _stripe_request(client, path, page_params)
        data = payload.get("data") or []
        items.extend(data)
        if not payload.get("has_more") or not data:
            break
        starting_after = data[-1].get("id")
        if not starting_after:
            break
    return items


def _monthly_normalized_amount(price: dict[str, Any], quantity: int) -> float:
    """Normalize a subscription item's price to a monthly amount, in cents."""
    unit_amount = price.get("unit_amount") or 0
    recurring = price.get("recurring") or {}
    interval = recurring.get("interval") or "month"
    interval_count = recurring.get("interval_count") or 1
    total = unit_amount * quantity
    if interval == "year":
        return total / (12 * interval_count)
    if interval == "week":
        return total * (52 / 12) / interval_count
    if interval == "day":
        return total * (365 / 12) / interval_count
    # month (default)
    return total / interval_count


async def _ingest_stripe_revenue(client: httpx.AsyncClient, conn: AsyncConnection) -> int:
    lookback_start = datetime.now(UTC) - timedelta(days=STRIPE_LOOKBACK_DAYS)
    invoices = await _stripe_list_all(
        client,
        "/invoices",
        {
            "status": "paid",
            "limit": 100,
            "created[gte]": int(lookback_start.timestamp()),
        },
    )

    daily: dict[date, dict[str, Any]] = defaultdict(
        lambda: {"gross_collected_cents": 0, "paid_invoice_count": 0, "currency": "usd"}
    )
    for invoice in invoices:
        amount_paid = invoice.get("amount_paid") or 0
        if amount_paid <= 0:
            continue
        status_transitions = invoice.get("status_transitions") or {}
        paid_at_ts = status_transitions.get("paid_at") or invoice.get("created")
        if not paid_at_ts:
            continue
        activity_date = _utc_date(datetime.fromtimestamp(paid_at_ts, tz=UTC))
        bucket = daily[activity_date]
        bucket["gross_collected_cents"] += amount_paid
        bucket["paid_invoice_count"] += 1
        currency = invoice.get("currency")
        if currency:
            bucket["currency"] = currency

    now = datetime.now(UTC)
    for activity_date, bucket in daily.items():
        await conn.execute(
            text(
                """
                INSERT INTO analytics.stripe_revenue_daily
                    (activity_date, gross_collected_cents, paid_invoice_count,
                     currency, updated_at)
                VALUES
                    (:activity_date, :gross_collected_cents, :paid_invoice_count,
                     :currency, :updated_at)
                ON CONFLICT (activity_date) DO UPDATE SET
                    gross_collected_cents = EXCLUDED.gross_collected_cents,
                    paid_invoice_count = EXCLUDED.paid_invoice_count,
                    currency = EXCLUDED.currency,
                    updated_at = EXCLUDED.updated_at
                """
            ),
            {
                "activity_date": activity_date,
                "gross_collected_cents": bucket["gross_collected_cents"],
                "paid_invoice_count": bucket["paid_invoice_count"],
                "currency": bucket["currency"],
                "updated_at": now,
            },
        )
    return len(daily)


async def _ingest_stripe_mrr(client: httpx.AsyncClient, conn: AsyncConnection) -> int:
    mrr_cents = 0.0
    active_subscriptions = 0
    for status in ("active", "trialing"):
        subscriptions = await _stripe_list_all(
            client,
            "/subscriptions",
            {"status": status, "limit": 100, "expand[]": "data.items.data.price"},
        )
        for subscription in subscriptions:
            active_subscriptions += 1
            items = (subscription.get("items") or {}).get("data") or []
            for item in items:
                price = item.get("price") or {}
                quantity = item.get("quantity") or 1
                mrr_cents += _monthly_normalized_amount(price, quantity)

    captured_date = date.today()
    now = datetime.now(UTC)
    await conn.execute(
        text(
            """
            INSERT INTO analytics.stripe_mrr_snapshot
                (captured_date, mrr_cents, arr_cents, active_subscriptions, updated_at)
            VALUES
                (:captured_date, :mrr_cents, :arr_cents, :active_subscriptions, :updated_at)
            ON CONFLICT (captured_date) DO UPDATE SET
                mrr_cents = EXCLUDED.mrr_cents,
                arr_cents = EXCLUDED.arr_cents,
                active_subscriptions = EXCLUDED.active_subscriptions,
                updated_at = EXCLUDED.updated_at
            """
        ),
        {
            "captured_date": captured_date,
            "mrr_cents": round(mrr_cents),
            "arr_cents": round(mrr_cents * 12),
            "active_subscriptions": active_subscriptions,
            "updated_at": now,
        },
    )
    return 1


async def ingest_stripe(conn: AsyncConnection) -> int:
    """Ingest Stripe daily revenue and an MRR/ARR snapshot for today."""
    if not settings.stripe_secret_key:
        logger.warning("Stripe secret key not configured, skipping Stripe ingestion")
        return 0
    async with httpx.AsyncClient() as client:
        revenue_rows = await _ingest_stripe_revenue(client, conn)
        mrr_rows = await _ingest_stripe_mrr(client, conn)
    return revenue_rows + mrr_rows


# ---------------------------------------------------------------------------
# AWS Cost Explorer: daily cost by service
# ---------------------------------------------------------------------------


def _fetch_aws_cost_and_usage() -> list[dict[str, Any]]:
    import boto3

    client = boto3.client("ce", region_name=AWS_REGION)
    end = date.today()
    start = end - timedelta(days=AWS_COST_LOOKBACK_DAYS)

    results: list[dict[str, Any]] = []
    next_token: str | None = None
    while True:
        kwargs: dict[str, Any] = {
            "TimePeriod": {"Start": start.isoformat(), "End": end.isoformat()},
            "Granularity": "DAILY",
            "Metrics": ["UnblendedCost"],
            "GroupBy": [{"Type": "DIMENSION", "Key": "SERVICE"}],
        }
        if next_token:
            kwargs["NextPageToken"] = next_token
        response = client.get_cost_and_usage(**kwargs)
        results.extend(response.get("ResultsByTime", []))
        next_token = response.get("NextPageToken")
        if not next_token:
            break
    return results


async def ingest_aws_cost(conn: AsyncConnection) -> int:
    """Ingest daily AWS cost-by-service from Cost Explorer."""
    try:
        results_by_time = await asyncio.to_thread(_fetch_aws_cost_and_usage)
    except Exception:
        logger.exception("AWS Cost Explorer request failed, skipping AWS cost ingestion")
        return 0

    now = datetime.now(UTC)
    rows = 0
    for period in results_by_time:
        time_period = period.get("TimePeriod") or {}
        start = time_period.get("Start")
        if not start:
            continue
        activity_date = date.fromisoformat(start)
        for group in period.get("Groups", []):
            keys = group.get("Keys") or []
            service = keys[0] if keys else "unknown"
            amount_str = ((group.get("Metrics") or {}).get("UnblendedCost") or {}).get(
                "Amount", "0"
            )
            try:
                cost_usd = float(amount_str)
            except (TypeError, ValueError):
                cost_usd = 0.0
            await conn.execute(
                text(
                    """
                    INSERT INTO analytics.aws_cost_daily
                        (activity_date, service, cost_usd, updated_at)
                    VALUES
                        (:activity_date, :service, :cost_usd, :updated_at)
                    ON CONFLICT (activity_date, service) DO UPDATE SET
                        cost_usd = EXCLUDED.cost_usd,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "activity_date": activity_date,
                    "service": service[:128],
                    "cost_usd": cost_usd,
                    "updated_at": now,
                },
            )
            rows += 1
    return rows


# ---------------------------------------------------------------------------
# E2B: daily sandbox usage/cost
# ---------------------------------------------------------------------------


async def ingest_e2b(conn: AsyncConnection) -> int:
    """Ingest daily E2B sandbox usage/cost from the (unofficial) billing API."""
    cookie = os.environ.get("E2B_SESSION_COOKIE")
    if not cookie:
        logger.warning("E2B_SESSION_COOKIE not configured, skipping E2B ingestion")
        return 0

    team_slug = os.environ.get("E2B_TEAM_SLUG", DEFAULT_E2B_TEAM_SLUG)
    trpc_input = json.dumps({"0": {"json": {"teamSlug": team_slug}}})
    url = f"{E2B_API_BASE}?batch=1&input={urllib.parse.quote(trpc_input)}"

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                url,
                headers={"Cookie": cookie},
                timeout=30.0,
            )
        if response.status_code == 401:
            logger.warning("E2B session cookie is expired/unauthorized, skipping E2B ingestion")
            return 0
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError:
        logger.exception("E2B billing request failed, skipping E2B ingestion")
        return 0
    except ValueError:
        logger.warning(
            "E2B billing response was not JSON (likely an expired session), skipping"
        )
        return 0

    try:
        day_usages = payload[0]["result"]["data"]["json"]["day_usages"]
    except (KeyError, IndexError, TypeError):
        logger.warning("E2B billing response had an unexpected shape, skipping E2B ingestion")
        return 0

    now = datetime.now(UTC)
    rows = 0
    for usage in day_usages:
        raw_date = usage.get("date")
        if not raw_date:
            continue
        try:
            activity_date = datetime.fromisoformat(raw_date.replace("Z", "+00:00")).date()
        except ValueError:
            continue
        cpu_hours = usage.get("cpu_hours") or 0
        ram_gib_hours = usage.get("ram_gib_hours") or 0
        price_cpu = usage.get("price_for_cpu") or 0
        price_ram = usage.get("price_for_ram") or 0
        sandbox_count = usage.get("sandbox_count") or 0
        total_cost_usd = price_cpu + price_ram
        await conn.execute(
            text(
                """
                INSERT INTO analytics.e2b_cost_daily
                    (activity_date, cpu_hours, ram_gib_hours, price_cpu_usd, price_ram_usd,
                     sandbox_count, total_cost_usd, updated_at)
                VALUES
                    (:activity_date, :cpu_hours, :ram_gib_hours, :price_cpu_usd, :price_ram_usd,
                     :sandbox_count, :total_cost_usd, :updated_at)
                ON CONFLICT (activity_date) DO UPDATE SET
                    cpu_hours = EXCLUDED.cpu_hours,
                    ram_gib_hours = EXCLUDED.ram_gib_hours,
                    price_cpu_usd = EXCLUDED.price_cpu_usd,
                    price_ram_usd = EXCLUDED.price_ram_usd,
                    sandbox_count = EXCLUDED.sandbox_count,
                    total_cost_usd = EXCLUDED.total_cost_usd,
                    updated_at = EXCLUDED.updated_at
                """
            ),
            {
                "activity_date": activity_date,
                "cpu_hours": cpu_hours,
                "ram_gib_hours": ram_gib_hours,
                "price_cpu_usd": price_cpu,
                "price_ram_usd": price_ram,
                "sandbox_count": sandbox_count,
                "total_cost_usd": total_cost_usd,
                "updated_at": now,
            },
        )
        rows += 1
    return rows


# ---------------------------------------------------------------------------
# Sentry: daily error counts by project
# ---------------------------------------------------------------------------


async def ingest_sentry(conn: AsyncConnection) -> int:
    """Ingest daily error counts per project from Sentry's stats API."""
    token = os.environ.get("SENTRY_ANALYTICS_TOKEN")
    if not token:
        logger.warning("Sentry token not configured, skipping")
        return 0
    org = os.environ.get("SENTRY_ORG")
    if not org:
        logger.warning("SENTRY_ORG not configured, skipping Sentry ingestion")
        return 0

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{SENTRY_API_BASE}/organizations/{org}/stats_v2/",
                headers={"Authorization": f"Bearer {token}"},
                params={
                    "category": "error",
                    "interval": "1d",
                    "field": "sum(quantity)",
                    "groupBy": ["project", "outcome"],
                    "statsPeriod": "90d",
                },
                timeout=30.0,
            )
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError:
        logger.exception("Sentry stats request failed, skipping Sentry ingestion")
        return 0
    except ValueError:
        logger.warning("Sentry stats response was not JSON, skipping Sentry ingestion")
        return 0

    intervals = payload.get("intervals") or []
    groups = payload.get("groups") or []
    if not intervals or not groups:
        logger.warning("Sentry stats response had no groups/intervals, skipping upsert")
        return 0

    project_names = {
        str(project.get("id")): project.get("slug") or str(project.get("id"))
        for project in payload.get("projects", [])
    } or {}

    now = datetime.now(UTC)
    rows = 0
    for group in groups:
        by = group.get("by") or {}
        if by.get("outcome") not in (None, "accepted"):
            continue
        project_key = str(by.get("project", "unknown"))
        project_name = project_names.get(project_key, project_key)
        totals = ((group.get("totals") or {}).get("sum(quantity)")) or []
        series = ((group.get("series") or {}).get("sum(quantity)")) or totals
        for idx, interval_start in enumerate(intervals):
            try:
                activity_date = datetime.fromisoformat(
                    interval_start.replace("Z", "+00:00")
                ).date()
            except ValueError:
                continue
            error_count = series[idx] if idx < len(series) else 0
            if not error_count:
                continue
            await conn.execute(
                text(
                    """
                    INSERT INTO analytics.sentry_errors_daily
                        (activity_date, project, surface, release, error_count, updated_at)
                    VALUES
                        (:activity_date, :project, NULL, '', :error_count, :updated_at)
                    ON CONFLICT (activity_date, project, release) DO UPDATE SET
                        error_count = EXCLUDED.error_count,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "activity_date": activity_date,
                    "project": project_name[:128],
                    "error_count": int(error_count),
                    "updated_at": now,
                },
            )
            rows += 1
    return rows


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------


async def _run_provider(
    name: str,
    conn: AsyncConnection,
    coro: Awaitable[int],
) -> tuple[str, int, Exception | None]:
    try:
        rows = await coro
        await conn.commit()
        return name, rows, None
    except Exception as exc:  # noqa: BLE001 - best-effort per-provider isolation
        await conn.rollback()
        logger.exception("Provider ingestion failed: %s", name)
        return name, 0, exc


async def run() -> dict[str, int]:
    summary: dict[str, int] = {}
    async with engine.connect() as conn:
        for name, coro_factory in (
            ("stripe", lambda: ingest_stripe(conn)),
            ("aws_cost", lambda: ingest_aws_cost(conn)),
            ("e2b", lambda: ingest_e2b(conn)),
            ("sentry", lambda: ingest_sentry(conn)),
        ):
            provider_name, rows, error = await _run_provider(name, conn, coro_factory())
            summary[provider_name] = rows
            if error is None:
                logger.info("Ingested %s: %d rows", provider_name, rows)
    return summary


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    summary = asyncio.run(run())
    print("Provider ingestion summary:")
    for provider, rows in summary.items():
        print(f"  {provider}: {rows} rows upserted")


if __name__ == "__main__":
    main()
