"""Typed integration-gateway product errors."""

from __future__ import annotations

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
        approval_required: bool,
        approval_status: str,
    ) -> None:
        super().__init__(code, message, status_code=403)
        self.provider = provider
        self.tool = tool
        self.approval_required = approval_required
        self.approval_status = approval_status

    def structured_error(self) -> dict[str, object]:
        return {
            "code": self.code,
            "message": self.message,
            "provider": self.provider,
            "tool": self.tool,
            "approval": {
                "required": self.approval_required,
                "status": self.approval_status,
            },
        }


class IntegrationToolApprovalRequired(IntegrationToolPolicyError):
    def __init__(self, *, provider: str, tool: str) -> None:
        super().__init__(
            "integration_tool_approval_required",
            "This external action requires approval and is not supported until approved.",
            provider=provider,
            tool=tool,
            approval_required=True,
            approval_status="unsupported",
        )


class IntegrationToolNotAllowed(IntegrationToolPolicyError):
    def __init__(self, *, provider: str, tool: str) -> None:
        super().__init__(
            "integration_tool_not_allowed",
            "This provider tool is not allowed by the integration gateway.",
            provider=provider,
            tool=tool,
            approval_required=False,
            approval_status="not_applicable",
        )
