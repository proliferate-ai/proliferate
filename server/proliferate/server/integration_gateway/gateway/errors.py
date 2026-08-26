"""Typed integration-gateway product errors."""

from __future__ import annotations

from proliferate.server.api_errors import CloudApiError


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
