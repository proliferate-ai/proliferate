"""Workflow DB seam for the T3-WF lane (specs/developing/testing/scenarios.md).

Same in-process-against-the-real-DB pattern as ``billing_probe.py`` and
``integration_audit_probe.py``: the tier-3 workflow scenarios read most of what
they assert through the product's own HTTP surfaces (``GET
/v1/cloud/workflows/runs/{id}`` returns the run row AND its step-action ledger;
the trigger + trigger-item routes expose the poll seen-set), but the per-run
gateway token's frozen ``scope_json`` (PR E / E3, §2.6) has no HTTP surface. This
reads it directly so a scenario can assert the run's grant was frozen at the
expected namespaces.

Requires ``DATABASE_URL`` (the local profile DB, RELEASE_E2E_LOCAL_DATABASE_URL).

Usage:
  uv run python workflow_probe.py run-gateway-scope <run-id>
  uv run python workflow_probe.py backdate-schedule-cursor <trigger-id> [hours]

``backdate-schedule-cursor`` is the T3-WF-7 (desktop lane) time-shift seam: v1
schedules only accept hourly/daily RRULEs (no minutely), so a live test cannot
wait a real hour for the scheduler beat to fire. It shifts a schedule trigger's
``next_run_at`` cursor ``hours`` (default 2) into the past so the very next beat
tick enumerates a due occurrence and fires a run — the honest analog of tier-2's
Stripe test-clock / invitation-expiry backdate (real state, just time-shifted;
there is no product API to fast-forward the scheduler).

Prints one JSON object to stdout.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "server"))

from sqlalchemy import select, update  # noqa: E402

from proliferate.db.engine import async_session_factory  # noqa: E402
from proliferate.db.models.cloud.workflows import (  # noqa: E402
    WorkflowRunGatewayToken,
    WorkflowTrigger,
)
from proliferate.utils.time import utcnow  # noqa: E402


def _granted_namespaces(scope_json: object) -> list[str]:
    out: set[str] = set()
    if isinstance(scope_json, dict):
        for slot_scope in scope_json.values():
            if isinstance(slot_scope, dict):
                for ns in slot_scope.get("integrations") or []:
                    if isinstance(ns, str):
                        out.add(ns)
    return sorted(out)


async def run_gateway_scope(run_id: str) -> dict:
    async with async_session_factory() as db:
        row = (
            await db.execute(
                select(WorkflowRunGatewayToken)
                .where(WorkflowRunGatewayToken.workflow_run_id == run_id)
                .order_by(WorkflowRunGatewayToken.created_at.desc())
            )
        ).scalars().first()
        if row is None:
            return {
                "runId": run_id,
                "tokenStatus": None,
                "scopeJson": None,
                "grantedNamespaces": [],
                "error": "no gateway token row for run",
            }
        scope = row.scope_json if isinstance(row.scope_json, dict) else {}
        return {
            "runId": run_id,
            "tokenStatus": row.status,
            "scopeJson": scope,
            "grantedNamespaces": _granted_namespaces(scope),
        }


async def backdate_schedule_cursor(trigger_id: str, hours: float) -> dict:
    async with async_session_factory() as db:
        target = utcnow() - timedelta(hours=hours)
        async with db.begin():
            result = await db.execute(
                update(WorkflowTrigger)
                .where(WorkflowTrigger.id == trigger_id)
                .values(next_run_at=target)
            )
        return {
            "triggerId": trigger_id,
            "updated": result.rowcount,
            "nextRunAt": target.isoformat(),
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    p_scope = sub.add_parser("run-gateway-scope")
    p_scope.add_argument("run_id")
    p_backdate = sub.add_parser("backdate-schedule-cursor")
    p_backdate.add_argument("trigger_id")
    p_backdate.add_argument("hours", nargs="?", default="2", type=float)
    args = parser.parse_args()
    if args.command == "run-gateway-scope":
        out = asyncio.run(run_gateway_scope(args.run_id))
    else:
        out = asyncio.run(backdate_schedule_cursor(args.trigger_id, args.hours))
    print(json.dumps(out))
