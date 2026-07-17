"""Short committed boundaries for approval request and execution admission."""

from __future__ import annotations

from uuid import UUID

from proliferate.db import session_ops
from proliferate.db.store.integrations.action_approvals import ActionApprovalRecord
from proliferate.db.store.runtime_workers import IntegrationGatewayGrant
from proliferate.server.cloud.integration_gateway.domain.tool_policy import (
    ToolCallRequiresApproval,
)
from proliferate.server.cloud.integrations.action_approvals.service import (
    ExecutionAdmission,
    consume_action_for_execution,
    request_action_approval,
)


async def request_action_approval_committed(
    *,
    grant: IntegrationGatewayGrant,
    gateway_session_id: UUID,
    integration_account_id: UUID,
    integration_account_auth_version: int,
    verdict: ToolCallRequiresApproval,
    arguments: dict[str, object],
    account_label: str,
    source_label: str,
) -> ActionApprovalRecord:
    """Persist the request before returning an approval-required result."""
    async with session_ops.open_async_session() as db:
        approval = await request_action_approval(
            db,
            grant=grant,
            gateway_session_id=gateway_session_id,
            integration_account_id=integration_account_id,
            integration_account_auth_version=integration_account_auth_version,
            verdict=verdict,
            arguments=arguments,
            account_label=account_label,
            source_label=source_label,
        )
        await session_ops.commit_session(db)
        return approval


async def consume_action_for_execution_committed(
    *,
    approval_id: UUID,
    grant: IntegrationGatewayGrant,
    gateway_session_id: UUID,
    integration_account_id: UUID,
    integration_account_auth_version: int,
    verdict: ToolCallRequiresApproval,
    arguments: dict[str, object],
) -> ExecutionAdmission:
    """Commit one-time consumption before credentials or provider I/O.

    The later delivery slice must call this boundary and continue only for a
    ``consumed`` result. A process crash after this function returns cannot
    roll the CAS or its audit event back.
    """
    async with session_ops.open_async_session() as db:
        admission = await consume_action_for_execution(
            db,
            approval_id=approval_id,
            grant=grant,
            gateway_session_id=gateway_session_id,
            integration_account_id=integration_account_id,
            integration_account_auth_version=integration_account_auth_version,
            verdict=verdict,
            arguments=arguments,
        )
        await session_ops.commit_session(db)
        return admission
