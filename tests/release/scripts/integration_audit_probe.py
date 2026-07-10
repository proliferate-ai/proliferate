"""Integration-gateway audit seam for T3-INT-1 (specs/developing/testing/scenarios.md#T3-INT-1).

Same in-process-against-the-real-DB seam as ``billing_probe.py`` /
``prov1_fallback.py``: T3-INT-1's assertion is that a real agent turn (and the
org-policy negative) each leave the queryable audit row PR #1101 added —
``cloud_integration_tool_call_event`` (one row per ``integrations.call_tool``
proxied through the gateway, success or failure).

Why a DB seam and not HTTP: this branch exposes no product/admin HTTP endpoint
that lists these audit rows, so reading the table directly is the only faithful
way to assert "a tool call happened and how it went". The gateway that WRITES
the row is exercised for real (a live agent turn, and a live worker-bearer
call); only the read-back is a DB seam.

Usage:
  uv run python integration_audit_probe.py tool-call-events <user-email> \
      [--namespace exa] [--since-seconds N]

Prints one JSON object to stdout.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "server"))

from sqlalchemy import select  # noqa: E402

from proliferate.db.engine import async_session_factory  # noqa: E402
from proliferate.db.models.auth import User  # noqa: E402
from proliferate.db.models.cloud.integrations import (  # noqa: E402
    CloudIntegrationToolCallEvent,
)


async def _resolve_user(db, email: str) -> User | None:
    return (
        await db.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()


async def cmd_tool_call_events(
    email: str, namespace: str | None, since_seconds: int
) -> dict:
    async with async_session_factory() as db:
        user = await _resolve_user(db, email)
        if user is None:
            return {"error": f"no user found for email {email!r}"}
        since = datetime.now(timezone.utc) - timedelta(seconds=since_seconds)
        stmt = (
            select(CloudIntegrationToolCallEvent)
            .where(CloudIntegrationToolCallEvent.user_id == user.id)
            .where(CloudIntegrationToolCallEvent.created_at >= since)
            .order_by(CloudIntegrationToolCallEvent.created_at)
        )
        if namespace:
            stmt = stmt.where(
                CloudIntegrationToolCallEvent.integration_namespace == namespace
            )
        rows = list((await db.execute(stmt)).scalars().all())
        return {
            "userId": str(user.id),
            "events": [
                {
                    "id": str(row.id),
                    "namespace": row.integration_namespace,
                    "toolName": row.tool_name,
                    "ok": row.ok,
                    "errorCode": row.error_code,
                    "latencyMs": row.latency_ms,
                    "runtimeWorkerId": str(row.runtime_worker_id)
                    if row.runtime_worker_id
                    else None,
                    "organizationId": str(row.organization_id)
                    if row.organization_id
                    else None,
                    "createdAt": row.created_at.isoformat(),
                }
                for row in rows
            ],
            "error": None,
        }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    events = sub.add_parser(
        "tool-call-events",
        help="list cloud_integration_tool_call_event rows for a user",
    )
    events.add_argument("email")
    events.add_argument("--namespace", default=None)
    events.add_argument("--since-seconds", type=int, default=3600)
    return parser


def main() -> None:
    args = _build_parser().parse_args()
    if args.command == "tool-call-events":
        result = asyncio.run(
            cmd_tool_call_events(args.email, args.namespace, args.since_seconds)
        )
    else:  # pragma: no cover - argparse enforces the choices
        raise SystemExit(f"unknown command {args.command!r}")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
