"""Pydantic models for public SSO auth endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SsoAuthBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class SsoDiscoveryResponse(SsoAuthBaseModel):
    enabled: bool
    scope: Literal["deployment", "organization"] | None = None
    connection_id: str | None = Field(default=None, serialization_alias="connectionId")
    organization_id: str | None = Field(default=None, serialization_alias="organizationId")
    protocol: Literal["oidc", "saml"] | None = None
    display_name: str | None = Field(default=None, serialization_alias="displayName")
    reason: str | None = None


class StartSsoAuthRequest(SsoAuthBaseModel):
    client_state: str = Field(serialization_alias="clientState", validation_alias="clientState")
    code_challenge: str = Field(
        serialization_alias="codeChallenge",
        validation_alias="codeChallenge",
    )
    code_challenge_method: str = Field(
        default="S256",
        serialization_alias="codeChallengeMethod",
        validation_alias="codeChallengeMethod",
    )
    redirect_uri: str = Field(serialization_alias="redirectUri", validation_alias="redirectUri")
    email: str | None = None
    organization_id: str | None = Field(
        default=None,
        serialization_alias="organizationId",
        validation_alias="organizationId",
    )
    connection_id: str | None = Field(
        default=None,
        serialization_alias="connectionId",
        validation_alias="connectionId",
    )
    prompt: Literal["select_account"] | None = None


class StartSsoAuthResponse(SsoAuthBaseModel):
    provider: Literal["sso"] = "sso"
    authorization_url: str = Field(serialization_alias="authorizationUrl")
    state: str
    nonce: str
    expires_at: datetime = Field(serialization_alias="expiresAt")
    scope: Literal["deployment", "organization"]
    protocol: Literal["oidc", "saml"]
    connection_id: str | None = Field(default=None, serialization_alias="connectionId")
    organization_id: str | None = Field(default=None, serialization_alias="organizationId")
