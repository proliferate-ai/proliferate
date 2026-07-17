"""Wire models for product-authenticated integration action approvals."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from proliferate.db.store.integrations.action_approvals import ActionApprovalRecord
from proliferate.server.cloud.integrations.action_approvals.service import (
    ActionApprovalTransition,
)

ApprovalStatus = Literal["pending", "approved", "rejected", "consumed", "expired", "revoked"]
ApprovalTransitionResult = Literal["applied", "already_applied", "expired", "not_allowed"]


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ActionApprovalResponse(_CamelModel):
    approval_id: UUID
    status: ApprovalStatus
    provider: str
    tool: str
    integration_account_id: UUID
    integration_account_auth_version: int
    organization_id: UUID | None
    execution_session_id: UUID
    payload_digest: str
    action_summary: str
    account_label: str
    source_label: str
    target: str | None
    content_preview: str | None
    content_character_count: int | None
    requested_at: datetime
    expires_at: datetime
    approved_at: datetime | None
    rejected_at: datetime | None
    revoked_at: datetime | None
    consumed_at: datetime | None


class ActionApprovalListResponse(_CamelModel):
    items: list[ActionApprovalResponse]


class ActionApprovalTransitionResponse(_CamelModel):
    approval: ActionApprovalResponse
    result: ApprovalTransitionResult


def action_approval_response(record: ActionApprovalRecord) -> ActionApprovalResponse:
    return ActionApprovalResponse(
        approval_id=record.id,
        status=record.status,
        provider=record.provider,
        tool=record.tool,
        integration_account_id=record.integration_account_id,
        integration_account_auth_version=record.integration_account_auth_version,
        organization_id=record.organization_id,
        execution_session_id=record.gateway_session_id,
        payload_digest=record.payload_digest,
        action_summary=record.safe_summary,
        account_label=record.safe_account_label,
        source_label=record.safe_source_label,
        target=record.safe_target,
        content_preview=record.safe_content_preview,
        content_character_count=record.safe_content_character_count,
        requested_at=record.created_at,
        expires_at=record.expires_at,
        approved_at=record.approved_at,
        rejected_at=record.rejected_at,
        revoked_at=record.revoked_at,
        consumed_at=record.consumed_at,
    )


def action_approval_transition_response(
    transition: ActionApprovalTransition,
) -> ActionApprovalTransitionResponse:
    return ActionApprovalTransitionResponse(
        approval=action_approval_response(transition.approval),
        result=transition.result,
    )
