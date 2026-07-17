"""Orchestration for durable one-time integration action approvals."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CLOUD_INTEGRATION_ACTION_APPROVAL_TTL_SECONDS
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import action_approvals as approvals_store
from proliferate.db.store.runtime_workers import IntegrationGatewayGrant
from proliferate.server.cloud.integration_gateway.domain.tool_policy import (
    ToolCallRequiresApproval,
    decide_tool_call,
)
from proliferate.server.cloud.integrations.action_approvals.access import (
    ActionApprovalAccess,
)
from proliferate.server.cloud.integrations.action_approvals.domain.actions import (
    ActionBinding,
    bind_action,
)
from proliferate.utils.time import utcnow

DecisionKind = Literal["approve", "reject", "revoke"]
TransitionResult = Literal["applied", "already_applied", "expired", "not_allowed"]
AdmissionResult = Literal[
    "consumed",
    "already_consumed",
    "pending",
    "expired",
    "rejected",
    "revoked",
    "mismatch",
    "not_found",
]


class ActionApprovalAccountRevisionMismatch(ValueError):
    """The trusted integration account no longer matches the bound revision."""


@dataclass(frozen=True)
class ActionApprovalTransition:
    approval: approvals_store.ActionApprovalRecord
    result: TransitionResult


@dataclass(frozen=True)
class ExecutionAdmission:
    result: AdmissionResult
    approval: approvals_store.ActionApprovalRecord | None


async def _record_expiry(
    db: AsyncSession,
    transition: approvals_store.ActionApprovalStateTransition,
    *,
    now: datetime,
) -> None:
    await approvals_store.record_event(
        db,
        approval_id=transition.approval.id,
        event_type="expired",
        from_status=transition.from_status,
        to_status="expired",
        actor_type="system",
        actor_user_id=None,
        actor_runtime_worker_id=None,
        safe_action_summary=transition.approval.safe_summary,
        created_at=now,
    )


def _require_approval_verdict(verdict: ToolCallRequiresApproval) -> None:
    if (
        not isinstance(verdict, ToolCallRequiresApproval)
        or decide_tool_call(provider=verdict.provider, tool=verdict.tool) != verdict
    ):
        raise TypeError("A typed approval-required tool-policy verdict is required.")


async def _account_revision_matches(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
    integration_account_id: UUID,
    integration_account_auth_version: int,
    verdict: ToolCallRequiresApproval,
) -> bool:
    account = await accounts_store.get_ready_account_identity_for_provider(
        db,
        grant.owner_user_id,
        verdict.provider,
        organization_id=grant.organization_id,
        account_id=integration_account_id,
        for_update=True,
    )
    if (
        account is None
        or account.owner_user_id != grant.owner_user_id
        or account.auth_version != integration_account_auth_version
    ):
        return False
    if grant.organization_id is not None:
        membership = await organizations_store.get_active_membership(
            db,
            organization_id=grant.organization_id,
            user_id=grant.owner_user_id,
        )
        if membership is None:
            return False
    if grant.organization_id is None:
        return True
    if account.org_policy_enabled is not None:
        return account.org_policy_enabled
    return account.definition_enabled_by_default


async def request_action_approval(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
    gateway_session_id: UUID,
    integration_account_id: UUID,
    integration_account_auth_version: int,
    verdict: ToolCallRequiresApproval,
    arguments: dict[str, object],
    account_label: str,
    source_label: str,
) -> approvals_store.ActionApprovalRecord:
    _require_approval_verdict(verdict)
    if not await _account_revision_matches(
        db,
        grant=grant,
        integration_account_id=integration_account_id,
        integration_account_auth_version=integration_account_auth_version,
        verdict=verdict,
    ):
        raise ActionApprovalAccountRevisionMismatch
    binding = bind_action(
        owner_user_id=grant.owner_user_id,
        organization_id=grant.organization_id,
        integration_account_id=integration_account_id,
        integration_account_auth_version=integration_account_auth_version,
        runtime_worker_id=grant.runtime_worker_id,
        gateway_session_id=gateway_session_id,
        verdict=verdict,
        arguments=arguments,
        account_label=account_label,
        source_label=source_label,
    )
    now = utcnow()
    expires_at = now + timedelta(seconds=CLOUD_INTEGRATION_ACTION_APPROVAL_TTL_SECONDS)
    approval, created = await approvals_store.create_or_get_pending(
        db,
        owner_user_id=binding.owner_user_id,
        organization_id=binding.organization_id,
        integration_account_id=binding.integration_account_id,
        integration_account_auth_version=binding.integration_account_auth_version,
        runtime_worker_id=binding.runtime_worker_id,
        gateway_session_id=binding.gateway_session_id,
        provider=binding.provider,
        tool=binding.tool,
        payload_digest=binding.payload_digest,
        binding_digest=binding.binding_digest,
        idempotency_key=binding.idempotency_key,
        safe_summary=binding.presentation.summary,
        safe_account_label=binding.presentation.account_label,
        safe_source_label=binding.presentation.source_label,
        safe_target=binding.presentation.target,
        safe_content_preview=binding.presentation.content_preview,
        safe_content_character_count=binding.presentation.content_character_count,
        expires_at=expires_at,
        now=now,
    )
    if not created and approval.expires_at <= now:
        expired = await approvals_store.mark_expired_if_due(
            db,
            approval_id=approval.id,
            now=now,
        )
        if expired is not None:
            await _record_expiry(db, expired, now=now)
        approval, created = await approvals_store.create_or_get_pending(
            db,
            owner_user_id=binding.owner_user_id,
            organization_id=binding.organization_id,
            integration_account_id=binding.integration_account_id,
            integration_account_auth_version=binding.integration_account_auth_version,
            runtime_worker_id=binding.runtime_worker_id,
            gateway_session_id=binding.gateway_session_id,
            provider=binding.provider,
            tool=binding.tool,
            payload_digest=binding.payload_digest,
            binding_digest=binding.binding_digest,
            idempotency_key=binding.idempotency_key,
            safe_summary=binding.presentation.summary,
            safe_account_label=binding.presentation.account_label,
            safe_source_label=binding.presentation.source_label,
            safe_target=binding.presentation.target,
            safe_content_preview=binding.presentation.content_preview,
            safe_content_character_count=binding.presentation.content_character_count,
            expires_at=expires_at,
            now=now,
        )
    if created:
        await approvals_store.record_event(
            db,
            approval_id=approval.id,
            event_type="requested",
            from_status=None,
            to_status="pending",
            actor_type="runtime_worker",
            actor_user_id=None,
            actor_runtime_worker_id=grant.runtime_worker_id,
            safe_action_summary=approval.safe_summary,
            created_at=now,
        )
    return approval


async def _expire_due_for_user(db: AsyncSession, *, user_id: UUID) -> None:
    now = utcnow()
    expired = await approvals_store.expire_due_for_user(db, user_id=user_id, now=now)
    for transition in expired:
        await _record_expiry(db, transition, now=now)


async def list_action_approvals(
    db: AsyncSession,
    *,
    user_id: UUID,
    visible_organization_ids: frozenset[UUID],
    status: str | None,
) -> tuple[approvals_store.ActionApprovalRecord, ...]:
    await _expire_due_for_user(db, user_id=user_id)
    return await approvals_store.list_approvals_for_user(
        db,
        user_id=user_id,
        visible_organization_ids=visible_organization_ids,
        status=status,
    )


async def refresh_action_approval(
    db: AsyncSession, *, access: ActionApprovalAccess
) -> approvals_store.ActionApprovalRecord:
    now = utcnow()
    expired = await approvals_store.mark_expired_if_due(
        db,
        approval_id=access.approval.id,
        now=now,
    )
    if expired is not None:
        await _record_expiry(db, expired, now=now)
        return expired.approval
    current = await approvals_store.get_approval(db, access.approval.id)
    assert current is not None
    return current


async def transition_action_approval(
    db: AsyncSession,
    *,
    access: ActionApprovalAccess,
    decision: DecisionKind,
) -> ActionApprovalTransition:
    now = utcnow()
    expired = await approvals_store.mark_expired_if_due(
        db,
        approval_id=access.approval.id,
        now=now,
    )
    if expired is not None:
        await _record_expiry(db, expired, now=now)
        return ActionApprovalTransition(approval=expired.approval, result="expired")

    target = {"approve": "approved", "reject": "rejected", "revoke": "revoked"}[decision]
    allowed_current = ("pending", "approved") if decision == "revoke" else ("pending",)
    transitioned = await approvals_store.transition_if_current(
        db,
        approval_id=access.approval.id,
        current_statuses=allowed_current,
        target_status=target,
        now=now,
    )
    if transitioned is not None:
        await approvals_store.record_event(
            db,
            approval_id=transitioned.approval.id,
            event_type=target,
            from_status=transitioned.from_status,
            to_status=target,
            actor_type="user",
            actor_user_id=access.actor_user_id,
            actor_runtime_worker_id=None,
            safe_action_summary=transitioned.approval.safe_summary,
            created_at=now,
        )
        return ActionApprovalTransition(approval=transitioned.approval, result="applied")

    current = await approvals_store.get_approval(db, access.approval.id)
    assert current is not None
    if current.status == target:
        result: TransitionResult = "already_applied"
    elif current.status == "expired":
        result = "expired"
    else:
        result = "not_allowed"
    return ActionApprovalTransition(approval=current, result=result)


def _matches_binding(
    approval: approvals_store.ActionApprovalRecord, binding: ActionBinding
) -> bool:
    return (
        approval.owner_user_id == binding.owner_user_id
        and approval.organization_id == binding.organization_id
        and approval.integration_account_id == binding.integration_account_id
        and approval.integration_account_auth_version == binding.integration_account_auth_version
        and approval.runtime_worker_id == binding.runtime_worker_id
        and approval.gateway_session_id == binding.gateway_session_id
        and approval.provider == binding.provider
        and approval.tool == binding.tool
        and approval.payload_digest == binding.payload_digest
        and approval.binding_digest == binding.binding_digest
    )


async def consume_action_for_execution(
    db: AsyncSession,
    *,
    approval_id: UUID,
    grant: IntegrationGatewayGrant,
    gateway_session_id: UUID,
    integration_account_id: UUID,
    integration_account_auth_version: int,
    verdict: ToolCallRequiresApproval,
    arguments: dict[str, object],
) -> ExecutionAdmission:
    """Stage the exact one-time CAS; callers must use the committed wrapper.

    This service performs no credential lookup and no network I/O. The public
    execution seam is ``consume_action_for_execution_committed`` in
    ``transactions.py``, which commits this CAS and audit before returning.
    """
    _require_approval_verdict(verdict)
    if not await _account_revision_matches(
        db,
        grant=grant,
        integration_account_id=integration_account_id,
        integration_account_auth_version=integration_account_auth_version,
        verdict=verdict,
    ):
        return ExecutionAdmission(result="mismatch", approval=None)
    current = await approvals_store.get_approval(db, approval_id)
    if current is None:
        return ExecutionAdmission(result="not_found", approval=None)
    binding = bind_action(
        owner_user_id=grant.owner_user_id,
        organization_id=grant.organization_id,
        integration_account_id=integration_account_id,
        integration_account_auth_version=integration_account_auth_version,
        runtime_worker_id=grant.runtime_worker_id,
        gateway_session_id=gateway_session_id,
        verdict=verdict,
        arguments=arguments,
        account_label=current.safe_account_label,
        source_label=current.safe_source_label,
    )
    if not _matches_binding(current, binding):
        return ExecutionAdmission(result="mismatch", approval=current)

    now = utcnow()
    consumed = await approvals_store.consume_approved_matching(
        db,
        approval_id=approval_id,
        owner_user_id=binding.owner_user_id,
        organization_id=binding.organization_id,
        integration_account_id=binding.integration_account_id,
        integration_account_auth_version=binding.integration_account_auth_version,
        runtime_worker_id=binding.runtime_worker_id,
        gateway_session_id=binding.gateway_session_id,
        provider=binding.provider,
        tool=binding.tool,
        payload_digest=binding.payload_digest,
        binding_digest=binding.binding_digest,
        now=now,
    )
    if consumed is not None:
        await approvals_store.record_event(
            db,
            approval_id=consumed.approval.id,
            event_type="consumed",
            from_status=consumed.from_status,
            to_status="consumed",
            actor_type="runtime_worker",
            actor_user_id=None,
            actor_runtime_worker_id=grant.runtime_worker_id,
            safe_action_summary=consumed.approval.safe_summary,
            created_at=now,
        )
        return ExecutionAdmission(result="consumed", approval=consumed.approval)

    expired = await approvals_store.mark_expired_if_due(
        db,
        approval_id=approval_id,
        now=now,
    )
    if expired is not None:
        await _record_expiry(db, expired, now=now)
        return ExecutionAdmission(result="expired", approval=expired.approval)
    current = await approvals_store.get_approval(db, approval_id)
    assert current is not None
    result_by_status: dict[str, AdmissionResult] = {
        "pending": "pending",
        "consumed": "already_consumed",
        "expired": "expired",
        "rejected": "rejected",
        "revoked": "revoked",
    }
    return ExecutionAdmission(
        result=result_by_status.get(current.status, "pending"),
        approval=current,
    )
