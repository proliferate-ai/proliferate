"""Managed-gateway spend/usage DB+admin seam for LOCAL-2 (tier-3 local-runtime).

Same in-process-against-the-real-server seam as ``billing_probe.py`` /
``integration_audit_probe.py``: the runner never holds LiteLLM admin/master
credentials, so the correlation half of LOCAL-2 runs here, inside the server
process, using the server's own configured LiteLLM client and importer. Admin
material stays private to the server/provisioner exactly as the tier-3 contract
requires; only non-secret correlation identifiers (``token_id``, request id,
model, token counts, USD cost) are printed.

Commands:

  enrollment <user-email>
      Resolve the user's personal gateway enrollment: token_id (the LiteLLM
      key hash used to correlate spend rows — NOT the raw key), team id,
      sync/budget status, and the USD credit balance. This is how the runner
      learns the ``token_id`` without it ever crossing the HTTP boundary.

  spend-logs <token-id> [--since-seconds N]
      Poll LiteLLM ``/spend/logs?summarize=false`` over the window and return
      only the rows whose ``api_key == token_id`` — the correlated managed
      requests with real request id, model, tokens, and cost.

  import-and-reconcile <user-email> [--since-seconds N]
      Run the real usage importer (``run_usage_import``) once, then read back
      the resulting ``agent_llm_usage_event`` rows for the user and the
      reconciled USD balance. This proves the product usage event + managed
      balance reconcile to the correlated request.

Requires ``DATABASE_URL`` (the runner passes ``RELEASE_E2E_LOCAL_DATABASE_URL``).
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

from proliferate.config import settings  # noqa: E402
from proliferate.db.engine import async_session_factory  # noqa: E402
from proliferate.db.models.auth import User  # noqa: E402
from proliferate.db.models.cloud.agent_gateway import (  # noqa: E402
    AgentGatewayEnrollment,
    AgentLlmUsageEvent,
)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


async def _resolve_user(db, email: str) -> User | None:
    return (
        await db.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()


async def _remaining_balance(db, billing_subject_id) -> dict:
    """Best-effort USD balance for the enrollment's billing subject."""
    try:
        from proliferate.db.store import agent_gateway as agent_gateway_store

        balance = await agent_gateway_store.get_remaining_credit_usd(db, billing_subject_id)
        return {
            "grantedUsd": float(balance.granted_usd),
            "remainingUsd": float(balance.remaining_usd),
        }
    except Exception as exc:  # pragma: no cover - defensive; balance is advisory
        return {"grantedUsd": None, "remainingUsd": None, "balanceError": str(exc)}


async def enrollment(email: str) -> dict:
    async with async_session_factory() as db:
        user = await _resolve_user(db, email)
        if user is None:
            return {"error": f"no user found for email {email!r}"}
        row = (
            await db.execute(
                select(AgentGatewayEnrollment).where(
                    AgentGatewayEnrollment.user_id == user.id,
                    AgentGatewayEnrollment.subject_kind == "user",
                )
            )
        ).scalar_one_or_none()
        if row is None:
            return {
                "error": "no personal gateway enrollment row for user",
                "userId": str(user.id),
                "gatewayEnabled": settings.agent_gateway_enabled,
            }
        balance = await _remaining_balance(db, row.billing_subject_id)
        return {
            "userId": str(user.id),
            # token_id == the LiteLLM key hash; the raw key never appears here.
            "tokenId": row.virtual_key_id,
            "teamId": row.litellm_team_id,
            "billingSubjectId": str(row.billing_subject_id),
            "syncStatus": row.sync_status,
            "budgetStatus": row.budget_status,
            "gatewayEnabled": settings.agent_gateway_enabled,
            **balance,
        }


async def spend_logs(token_id: str, since_seconds: int) -> dict:
    if not settings.agent_gateway_litellm_base_url or not settings.agent_gateway_litellm_master_key:
        return {
            "error": "litellm_unconfigured",
            "detail": "server has no agent_gateway_litellm_base_url/master_key configured",
            "rows": [],
        }
    from proliferate.integrations import litellm
    from proliferate.integrations.litellm import LiteLLMIntegrationError

    now = datetime.now(timezone.utc)
    start = now - timedelta(seconds=since_seconds)
    try:
        entries = await litellm.page_spend_logs(
            start_date=start.date().isoformat(),
            end_date=(now + timedelta(days=1)).date().isoformat(),
        )
    except LiteLLMIntegrationError as error:
        return {"error": error.code, "detail": error.message, "rows": []}
    matched = [
        {
            "requestId": e.request_id,
            "apiKey": e.api_key,
            "model": e.model,
            "promptTokens": e.prompt_tokens,
            "completionTokens": e.completion_tokens,
            "totalTokens": e.total_tokens,
            "spend": e.spend,
            "startTime": e.start_time,
            "endTime": e.end_time,
        }
        for e in entries
        if e.api_key == token_id
    ]
    return {"tokenId": token_id, "rows": matched, "totalRowsScanned": len(entries)}


async def delete_key(token_id: str) -> dict:
    """Cleanup seam: delete a run-scoped virtual key by its ``token_id`` (hash).

    LOCAL-2 registers the minted virtual key in the cleanup ledger; this is the
    reconciliation executor. Uses the server's own configured admin client, so
    the runner never holds the LiteLLM master key. Tolerant of an
    already-absent key (idempotent cleanup)."""
    if not settings.agent_gateway_litellm_base_url or not settings.agent_gateway_litellm_master_key:
        return {"error": "litellm_unconfigured", "deleted": False}
    from proliferate.integrations.litellm.client import _admin_request  # noqa: PLC2701
    from proliferate.integrations.litellm import LiteLLMIntegrationError

    try:
        await _admin_request("POST", "/key/delete", json_body={"keys": [token_id]})
    except LiteLLMIntegrationError as error:
        return {"tokenId": token_id, "deleted": False, "error": error.code, "detail": error.message}
    return {"tokenId": token_id, "deleted": True}


async def import_and_reconcile(email: str, since_seconds: int) -> dict:
    from proliferate.server.cloud.agent_gateway.usage_import import run_usage_import

    async with async_session_factory() as db:
        user = await _resolve_user(db, email)
        if user is None:
            return {"error": f"no user found for email {email!r}"}
        try:
            result = await run_usage_import(db)
            await db.commit()
        except Exception as exc:  # pragma: no cover - surfaced as a red assertion
            return {"error": "usage_import_failed", "detail": str(exc)}

        since = datetime.now(timezone.utc) - timedelta(seconds=since_seconds)
        events = (
            await db.execute(
                select(AgentLlmUsageEvent).where(
                    AgentLlmUsageEvent.user_id == user.id,
                    AgentLlmUsageEvent.occurred_at >= since,
                )
            )
        ).scalars().all()
        row = (
            await db.execute(
                select(AgentGatewayEnrollment).where(
                    AgentGatewayEnrollment.user_id == user.id,
                    AgentGatewayEnrollment.subject_kind == "user",
                )
            )
        ).scalar_one_or_none()
        balance = (
            await _remaining_balance(db, row.billing_subject_id) if row is not None else {}
        )
        return {
            "userId": str(user.id),
            "imported": result.imported,
            "skippedDuplicate": result.skipped_duplicate,
            "unresolved": result.unresolved,
            "budgetStatus": row.budget_status if row is not None else None,
            "events": [
                {
                    "id": str(e.id),
                    "litellmRequestId": e.litellm_request_id,
                    "virtualKeyId": e.virtual_key_id,
                    "model": e.model,
                    "promptTokens": e.prompt_tokens,
                    "completionTokens": e.completion_tokens,
                    "totalTokens": e.total_tokens,
                    "costUsd": e.cost_usd,
                    "sessionId": e.session_id,
                    "occurredAt": _iso(e.occurred_at),
                    "status": e.status,
                }
                for e in events
            ],
            **balance,
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    p_enroll = sub.add_parser("enrollment")
    p_enroll.add_argument("email")

    p_spend = sub.add_parser("spend-logs")
    p_spend.add_argument("token_id")
    p_spend.add_argument("--since-seconds", type=int, default=3600)

    p_import = sub.add_parser("import-and-reconcile")
    p_import.add_argument("email")
    p_import.add_argument("--since-seconds", type=int, default=3600)

    p_delete = sub.add_parser("delete-key")
    p_delete.add_argument("token_id")

    args = parser.parse_args()
    if args.command == "enrollment":
        out = asyncio.run(enrollment(args.email))
    elif args.command == "spend-logs":
        out = asyncio.run(spend_logs(args.token_id, args.since_seconds))
    elif args.command == "delete-key":
        out = asyncio.run(delete_key(args.token_id))
    else:
        out = asyncio.run(import_and_reconcile(args.email, args.since_seconds))
    print(json.dumps(out))
