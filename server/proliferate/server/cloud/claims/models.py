"""Request and response schemas for workspace claims."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

Permission = Literal["read", "write", "control"]


class ClaimWorkspaceRequest(BaseModel):
    source_kind: Literal["slack", "automation", "api", "manual"] = Field(
        default="manual",
        alias="sourceKind",
    )


class ClaimWorkspaceResponse(BaseModel):
    claim_id: str = Field(serialization_alias="claimId")
    cloud_workspace_id: str = Field(serialization_alias="cloudWorkspaceId")
    exposure_id: str = Field(serialization_alias="exposureId")
    exposure_revision: int = Field(serialization_alias="exposureRevision")
    claimed_at: str = Field(serialization_alias="claimedAt")
    claimed_by_user_id: str = Field(serialization_alias="claimedByUserId")


class DirectAccessTokenRequest(BaseModel):
    target_anyharness_workspace_id: str | None = Field(
        default=None,
        alias="targetAnyharnessWorkspaceId",
    )
    cloud_session_id: str | None = Field(default=None, alias="cloudSessionId")
    anyharness_session_id: str | None = Field(default=None, alias="anyharnessSessionId")
    permissions: list[Permission] = Field(
        default_factory=lambda: ["read", "write", "control"],
    )

    @field_validator("permissions")
    @classmethod
    def _permissions_non_empty(cls, value: list[Permission]) -> list[Permission]:
        cleaned = sorted(set(value), key=("read", "write", "control").index)
        if not cleaned:
            raise ValueError("At least one permission is required.")
        return cleaned


class DirectAccessTokenResponse(BaseModel):
    token: str
    token_id: str = Field(serialization_alias="tokenId")
    jti: str
    expires_at: str = Field(serialization_alias="expiresAt")
    anyharness_base_url: str = Field(serialization_alias="anyharnessBaseUrl")
    target_id: str = Field(serialization_alias="targetId")
    cloud_workspace_id: str = Field(serialization_alias="cloudWorkspaceId")
    anyharness_workspace_id: str = Field(serialization_alias="anyharnessWorkspaceId")
    cloud_session_id: str | None = Field(default=None, serialization_alias="cloudSessionId")
    anyharness_session_id: str | None = Field(
        default=None,
        serialization_alias="anyharnessSessionId",
    )
    permissions: list[Permission]


class RevokeClaimTokenResponse(BaseModel):
    token_id: str = Field(serialization_alias="tokenId")
    status: Literal["revoked", "expired", "active"]
    revoked_at: str | None = Field(default=None, serialization_alias="revokedAt")
