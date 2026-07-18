"""Typed integration-gateway product errors."""

from __future__ import annotations

from proliferate.db.store.integrations.action_approvals import ActionApprovalRecord
from proliferate.server.cloud.errors import CloudApiError


class IntegrationToolPolicyError(CloudApiError):
    """Base for fail-closed provider-tool policy results."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        provider: str,
        tool: str,
        approval: dict[str, object],
    ) -> None:
        super().__init__(code, message, status_code=403)
        self.provider = provider
        self.tool = tool
        self.approval = approval

    def structured_error(self) -> dict[str, object]:
        return {
            "code": self.code,
            "message": self.message,
            "provider": self.provider,
            "tool": self.tool,
            "approval": self.approval,
        }


class IntegrationToolApprovalRequired(IntegrationToolPolicyError):
    def __init__(
        self,
        *,
        provider: str,
        tool: str,
        approval: ActionApprovalRecord,
    ) -> None:
        super().__init__(
            "integration_tool_approval_required",
            "This external action requires a durable product approval before execution.",
            provider=provider,
            tool=tool,
            approval={
                "required": True,
                "id": str(approval.id),
                "status": approval.status,
                "expiresAt": approval.expires_at.isoformat(),
                "payloadDigest": approval.payload_digest,
                "actionSummary": approval.safe_summary,
                "integrationAccountId": str(approval.integration_account_id),
                "integrationAccountAuthVersion": approval.integration_account_auth_version,
                "organizationId": (
                    str(approval.organization_id) if approval.organization_id is not None else None
                ),
                "executionSessionId": str(approval.gateway_session_id),
                "workspaceId": approval.workspace_id,
                "anyharnessSessionId": approval.anyharness_session_id,
                "accountLabel": approval.safe_account_label,
                "sourceLabel": approval.safe_source_label,
                "target": approval.safe_target,
                "contentPreview": approval.safe_content_preview,
                "contentCharacterCount": approval.safe_content_character_count,
            },
        )


class IntegrationGatewaySessionRequired(IntegrationToolPolicyError):
    def __init__(self, *, provider: str, tool: str) -> None:
        super().__init__(
            "integration_gateway_session_required",
            "Initialize the MCP connection before requesting approval for this action.",
            provider=provider,
            tool=tool,
            approval={"required": False, "status": "session_required"},
        )


class IntegrationToolNotAllowed(IntegrationToolPolicyError):
    def __init__(self, *, provider: str, tool: str) -> None:
        super().__init__(
            "integration_tool_not_allowed",
            "This provider tool is not allowed by the integration gateway.",
            provider=provider,
            tool=tool,
            approval={"required": False, "status": "not_applicable"},
        )
