"""Target resolution stage for cloud automation execution."""

from __future__ import annotations

import json

from proliferate.constants.automations import (
    AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
    AUTOMATION_TARGET_MODE_SHARED_CLOUD,
)
from proliferate.constants.cloud import CloudTargetKind, CloudTargetStatus
from proliferate.db import engine as db_engine
from proliferate.db.store.automation_run_claim_transitions import (
    attach_cloud_target_snapshot_to_run,
)
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.automations.domain.claim_lifecycle import (
    CLOUD_WORKSPACE_ATTACHMENT_TRANSITION,
    claim_is_active,
)
from proliferate.server.automations.worker.cloud_execution.context import (
    AutomationExecutionContext,
    TargetExecutionContext,
)
from proliferate.server.automations.worker.cloud_executor_claims import fail_claim
from proliferate.utils.time import utcnow


def _ready_agent_kinds(target: targets_store.CloudTargetSnapshot) -> tuple[str, ...]:
    providers_json = target.inventory.providers_json if target.inventory is not None else None
    if not providers_json:
        return ()
    try:
        parsed = json.loads(providers_json)
    except json.JSONDecodeError:
        return ()
    if isinstance(parsed, dict):
        ready = parsed.get("readyAgentKinds")
        if isinstance(ready, list):
            return tuple(value for value in ready if isinstance(value, str))
    return ()


def _providers_inventory_present(target: targets_store.CloudTargetSnapshot) -> bool:
    providers_json = target.inventory.providers_json if target.inventory is not None else None
    if not providers_json:
        return False
    try:
        parsed = json.loads(providers_json)
    except json.JSONDecodeError:
        return False
    return isinstance(parsed, dict) and isinstance(parsed.get("readyAgentKinds"), list)


def _target_matches_run_scope(
    target: targets_store.CloudTargetSnapshot,
    ctx: AutomationExecutionContext,
) -> bool:
    if ctx.claim.target_mode == AUTOMATION_TARGET_MODE_SHARED_CLOUD:
        return (
            target.owner_scope == "organization"
            and target.organization_id is not None
            and target.organization_id == ctx.claim.organization_id
        )
    if ctx.claim.target_mode == AUTOMATION_TARGET_MODE_PERSONAL_CLOUD:
        return target.owner_scope == "personal" and (
            target.owner_user_id == ctx.claim.user_id
            or target.created_by_user_id == ctx.claim.user_id
        )
    return True


async def _load_or_select_target(
    ctx: AutomationExecutionContext,
) -> targets_store.CloudTargetSnapshot | None:
    async with db_engine.async_session_factory() as db:
        if ctx.claim.cloud_target_id_snapshot is not None:
            target = await targets_store.get_visible_target_by_id(
                db,
                target_id=ctx.claim.cloud_target_id_snapshot,
                user_id=ctx.claim.user_id,
            )
            if target is not None and _target_matches_run_scope(target, ctx):
                return target
            return None
        targets = await targets_store.list_visible_targets(db, user_id=ctx.claim.user_id)
        for target in targets:
            if (
                target.kind == CloudTargetKind.managed_cloud.value
                and target.status == CloudTargetStatus.online.value
                and target.archived_at is None
                and _target_matches_run_scope(target, ctx)
            ):
                return target
    return None


async def resolve_target_stage(
    ctx: AutomationExecutionContext,
) -> AutomationExecutionContext | None:
    if (
        ctx.claim.cloud_target_id_snapshot is None
        and ctx.claim.cloud_target_kind_snapshot is not None
    ):
        await fail_claim(ctx.claim, code="target_not_found")
        return None
    if ctx.claim.cloud_target_id_snapshot is None and (
        ctx.claim.anyharness_workspace_id is not None
        or ctx.claim.anyharness_session_id is not None
    ):
        await fail_claim(ctx.claim, code="target_required")
        return None
    target = await _load_or_select_target(ctx)
    if target is None:
        if ctx.claim.cloud_target_id_snapshot is not None:
            await fail_claim(ctx.claim, code="target_not_found")
            return None
        await fail_claim(ctx.claim, code="target_required")
        return None
    if target.archived_at is not None or target.status == CloudTargetStatus.archived.value:
        await fail_claim(ctx.claim, code="target_archived")
        return None
    if target.status != CloudTargetStatus.online.value:
        await fail_claim(ctx.claim, code="target_offline")
        return None
    if target.kind == CloudTargetKind.managed_cloud.value and target.sandbox_profile_id is None:
        await fail_claim(ctx.claim, code="sandbox_profile_required")
        return None

    claim = ctx.claim
    if (
        claim.cloud_target_id_snapshot is None
        or claim.sandbox_profile_id != target.sandbox_profile_id
    ):
        updated = await attach_cloud_target_snapshot_to_run(
            run_id=claim.id,
            claim_id=claim.claim_id,
            cloud_target_id=target.id,
            cloud_target_kind=target.kind,
            sandbox_profile_id=target.sandbox_profile_id,
            now=utcnow(),
            transition=CLOUD_WORKSPACE_ATTACHMENT_TRANSITION,
            claim_is_active=claim_is_active,
        )
        if updated is None:
            await fail_claim(claim, code="stale_claim")
            return None
        claim = updated

    ready_agent_kinds = _ready_agent_kinds(target)
    if (
        claim.agent_kind
        and _providers_inventory_present(target)
        and claim.agent_kind not in ready_agent_kinds
    ):
        await fail_claim(claim, code="target_agent_not_ready")
        return None

    return ctx.with_claim(claim).with_target(
        TargetExecutionContext(
            target_id=target.id,
            target_kind=target.kind,
            default_workspace_root=target.default_workspace_root,
            organization_id=target.organization_id,
            status=target.status,
            sandbox_profile_id=target.sandbox_profile_id,
            ready_agent_kinds=ready_agent_kinds,
        )
    )
