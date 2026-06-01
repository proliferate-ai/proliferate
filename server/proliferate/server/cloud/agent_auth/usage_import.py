"""Agent-auth usage import concern."""

from __future__ import annotations

import json
from datetime import timedelta
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud import (
    CloudAgentKind,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_agent_auth.records import (
    AgentGatewayBudgetSubjectRecord,
)
from proliferate.server.cloud.agent_auth.bifrost_clients import new_bifrost_admin_client
from proliferate.server.cloud.agent_auth.managed_credit_rules import _user_free_credit_period_key
from proliferate.server.cloud.agent_auth.router_materializations import (
    _disable_bifrost_virtual_keys_for_budget,
)
from proliferate.utils.time import utcnow

_ORG_ADMIN_ROLES = {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN}
_GATEWAY_GRANT_TTL = timedelta(days=7)
_DEFAULT_MANAGED_CREDIT_AGENT_KINDS: tuple[CloudAgentKind, ...] = ("claude",)
_USER_FREE_CREDIT_SOURCE = "signup_free_credit"
_CLEANUP_SELECTION_ERROR_CODES = {
    "credential_revoked",
    "credential_share_revoked",
}
_MANAGED_CODEX_HOME = "/home/user/.proliferate/anyharness/agent-auth/codex"
_OPENCODE_ALLOWED_AUTH_FILES: frozenset[str] = frozenset({".config/opencode/auth.json"})
_TERMINAL_AGENT_AUTH_REFRESH_COMMAND_STATUSES = frozenset(
    {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
        CloudCommandStatus.rejected.value,
        CloudCommandStatus.expired.value,
        CloudCommandStatus.superseded.value,
        CloudCommandStatus.failed_delivery.value,
    }
)


async def import_bifrost_usage_logs(
    db: AsyncSession,
    *,
    limit: int = 1000,
) -> int:
    if not settings.agent_gateway_enabled:
        return 0
    virtual_key_ids = await store.list_active_router_virtual_key_ids(
        db,
        router_kind="bifrost",
        limit=1000,
    )
    if not virtual_key_ids:
        return 0
    cursor = await store.get_usage_import_cursor(db, router_kind="bifrost")
    start_time = (
        cursor.last_seen_at - timedelta(minutes=5)
        if cursor is not None and cursor.last_seen_at is not None
        else utcnow() - timedelta(days=7)
    )
    client = new_bifrost_admin_client()
    imported = 0
    last_seen_at = cursor.last_seen_at if cursor is not None else None
    last_seen_log_id = cursor.last_seen_router_log_id if cursor is not None else None
    page_limit = min(max(limit, 1), 1000)
    offset = 0
    while True:
        result = await client.list_logs(
            start_time=start_time,
            limit=page_limit,
            offset=offset,
            order="asc",
            virtual_key_ids=virtual_key_ids,
        )
        for entry in result.logs:
            if not entry.log_id:
                continue
            if entry.timestamp is not None and (
                last_seen_at is None or entry.timestamp >= last_seen_at
            ):
                last_seen_at = entry.timestamp
                last_seen_log_id = entry.log_id
            materialization = (
                await store.get_router_materialization_by_object_id(
                    db,
                    router_kind="bifrost",
                    router_object_kind="virtual_key",
                    router_object_id=entry.virtual_key_id,
                )
                if entry.virtual_key_id
                else None
            )
            policy = (
                await store.get_gateway_policy(db, materialization.policy_id)
                if materialization is not None and materialization.policy_id is not None
                else None
            )
            budget = (
                await store.get_budget_subject(db, policy.budget_subject_id)
                if policy is not None and policy.budget_subject_id is not None
                else None
            )
            cost = entry.cost or Decimal("0")
            status = entry.status
            raw_usage: dict[str, object] = {"tokenUsage": entry.token_usage, "raw": entry.raw}
            if (
                budget is not None
                and budget.budget_kind == "proliferate_managed"
                and entry.status == "success"
                and (entry.cost is None or entry.cost <= 0)
            ):
                status = "needs_review"
                raw_usage["proliferateImportWarning"] = "missing_or_zero_managed_cost"
            usage = entry.token_usage
            inserted = await store.insert_llm_usage_event_once(
                db,
                router_kind="bifrost",
                router_log_id=entry.log_id,
                router_virtual_key_id=entry.virtual_key_id,
                router_provider_key_id=entry.selected_key_id,
                materialization=materialization,
                policy=policy,
                budget=budget,
                provider=entry.provider,
                model=entry.model,
                status=status,
                cost_usd=format(cost, "f"),
                prompt_tokens=_usage_token(usage, "prompt_tokens", "input_tokens"),
                completion_tokens=_usage_token(
                    usage,
                    "completion_tokens",
                    "output_tokens",
                ),
                total_tokens=_usage_token(usage, "total_tokens"),
                occurred_at=entry.timestamp,
                raw_usage_json=json.dumps(
                    raw_usage,
                    separators=(",", ":"),
                    sort_keys=True,
                ),
            )
            if inserted is not None:
                imported += 1
                if budget is not None and budget.budget_kind == "proliferate_managed":
                    if status == "needs_review":
                        await _mark_managed_budget_usage_needs_review(db, budget=budget)
                    else:
                        await _exhaust_managed_budget_if_needed(db, budget=budget)
        offset += len(result.logs)
        if len(result.logs) < page_limit:
            break
        if result.total_count is not None and offset >= result.total_count:
            break
    if last_seen_at is not None or last_seen_log_id is not None:
        await store.upsert_usage_import_cursor(
            db,
            router_kind="bifrost",
            last_seen_at=last_seen_at,
            last_seen_router_log_id=last_seen_log_id,
        )
    return imported


def _usage_token(payload: dict[str, object], *keys: str) -> int | None:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
    return None


async def _mark_managed_budget_usage_needs_review(
    db: AsyncSession,
    *,
    budget: AgentGatewayBudgetSubjectRecord,
) -> None:
    await store.ensure_managed_budget_subject_for_owner(
        db,
        owner_scope=budget.owner_scope,
        owner_user_id=budget.owner_user_id,
        organization_id=budget.organization_id,
        included_budget_usd=budget.included_budget_usd,
        budget_duration=budget.budget_duration,
        entitlement_source=budget.entitlement_source,
        entitlement_period_key=budget.entitlement_period_key,
        litellm_team_id=budget.litellm_team_id,
        litellm_sync_status=budget.litellm_sync_status,
        litellm_sync_fingerprint=budget.litellm_sync_fingerprint,
        status="invalid",
        last_error_code="managed_usage_cost_missing",
        last_error_message=(
            "Bifrost returned a successful managed-credit request without a positive cost."
        ),
    )
    await _disable_bifrost_virtual_keys_for_budget(db, budget=budget)


async def _exhaust_managed_budget_if_needed(
    db: AsyncSession,
    *,
    budget: AgentGatewayBudgetSubjectRecord,
) -> None:
    used = await store.sum_llm_usage_cost_for_budget_subject(
        db,
        budget_subject_id=budget.id,
    )
    if used < Decimal(budget.included_budget_usd):
        return
    await store.ensure_managed_budget_subject_for_owner(
        db,
        owner_scope=budget.owner_scope,
        owner_user_id=budget.owner_user_id,
        organization_id=budget.organization_id,
        included_budget_usd=budget.included_budget_usd,
        budget_duration=budget.budget_duration,
        entitlement_source=budget.entitlement_source,
        entitlement_period_key=budget.entitlement_period_key,
        litellm_team_id=budget.litellm_team_id,
        litellm_sync_status=budget.litellm_sync_status,
        litellm_sync_fingerprint=budget.litellm_sync_fingerprint,
        status="exhausted",
        last_error_code="managed_credits_exhausted",
        last_error_message="Managed credits are exhausted.",
    )
    await _disable_bifrost_virtual_keys_for_budget(db, budget=budget)
    if budget.owner_scope == "personal" and budget.owner_user_id is not None:
        source = budget.entitlement_source or _USER_FREE_CREDIT_SOURCE
        period_key = budget.entitlement_period_key or _user_free_credit_period_key()
        await store.ensure_free_credit_entitlement(
            db,
            user_id=budget.owner_user_id,
            source=source,
            period_key=period_key,
            included_budget_usd=budget.included_budget_usd,
            budget_subject_id=budget.id,
            status="exhausted",
            last_error_code="managed_credits_exhausted",
            last_error_message="Managed credits are exhausted.",
        )
