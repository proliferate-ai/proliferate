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

Prints one JSON object to stdout.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "server"))

from sqlalchemy import select  # noqa: E402

from proliferate.db.engine import async_session_factory  # noqa: E402
from proliferate.db.models.cloud.workflows import WorkflowRunGatewayToken  # noqa: E402


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


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["run-gateway-scope"])
    parser.add_argument("run_id")
    args = parser.parse_args()
    out = asyncio.run(run_gateway_scope(args.run_id))
    print(json.dumps(out))
