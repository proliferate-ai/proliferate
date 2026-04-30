from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from proliferate.db.store.cloud_mcp.types import CloudMcpOAuthFlowRecord

OAuthFlowStatus = Literal["active", "exchanging", "completed", "expired", "cancelled", "failed"]


class StartCloudMcpOAuthFlowResponse(BaseModel):
    flow_id: UUID = Field(serialization_alias="flowId")
    authorization_url: str = Field(serialization_alias="authorizationUrl")
    status: OAuthFlowStatus
    expires_at: str = Field(serialization_alias="expiresAt")


class CloudMcpOAuthFlowStatusResponse(BaseModel):
    flow_id: UUID = Field(serialization_alias="flowId")
    status: OAuthFlowStatus
    authorization_url: str | None = Field(default=None, serialization_alias="authorizationUrl")
    expires_at: str = Field(serialization_alias="expiresAt")
    failure_code: str | None = Field(default=None, serialization_alias="failureCode")


class CloudMcpOAuthCallbackResponse(BaseModel):
    ok: bool
    status: str


def oauth_flow_start_payload(flow: CloudMcpOAuthFlowRecord) -> StartCloudMcpOAuthFlowResponse:
    return StartCloudMcpOAuthFlowResponse(
        flow_id=flow.id,
        authorization_url=flow.authorization_url,
        status=flow.status,  # type: ignore[arg-type]
        expires_at=flow.expires_at.isoformat(),
    )


def oauth_flow_status_payload(
    flow: CloudMcpOAuthFlowRecord,
    *,
    include_authorization_url: bool,
) -> CloudMcpOAuthFlowStatusResponse:
    return CloudMcpOAuthFlowStatusResponse(
        flow_id=flow.id,
        status=flow.status,  # type: ignore[arg-type]
        authorization_url=flow.authorization_url if include_authorization_url else None,
        expires_at=flow.expires_at.isoformat(),
        failure_code=flow.failure_code,
    )
