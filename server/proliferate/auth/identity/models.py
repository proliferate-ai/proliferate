"""Pydantic schemas for product-owned auth flows."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from proliferate.auth.identity.types import AuthProviderName
from proliferate.auth.models import UserRead
from proliferate.constants.auth import PASSWORD_EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH

AuthPurposeName = Literal["login", "link", "required_github_link"]


class StartAuthRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    purpose: AuthPurposeName = "login"
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
    prompt: Literal["select_account"] | None = None


class StartAuthResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    provider: AuthProviderName
    authorization_url: str | None = Field(
        default=None,
        serialization_alias="authorizationUrl",
    )
    state: str
    nonce: str
    expires_at: datetime = Field(serialization_alias="expiresAt")


class AppleMobileCompleteRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    state: str
    identity_token: str = Field(
        serialization_alias="identityToken",
        validation_alias="identityToken",
    )
    authorization_code: str | None = Field(
        default=None,
        serialization_alias="authorizationCode",
        validation_alias="authorizationCode",
    )
    email: str | None = None
    display_name: str | None = Field(
        default=None,
        serialization_alias="displayName",
        validation_alias="displayName",
    )


class AuthTokenRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    code: str
    code_verifier: str = Field(serialization_alias="codeVerifier", validation_alias="codeVerifier")
    grant_type: Literal["authorization_code"] = Field(
        default="authorization_code",
        serialization_alias="grantType",
        validation_alias="grantType",
    )


class AuthRefreshRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    refresh_token: str = Field(serialization_alias="refreshToken", validation_alias="refreshToken")
    grant_type: Literal["refresh_token"] = Field(
        default="refresh_token",
        serialization_alias="grantType",
        validation_alias="grantType",
    )


class PasswordLoginRequest(BaseModel):
    email: str = Field(max_length=PASSWORD_EMAIL_MAX_LENGTH)
    password: str = Field(max_length=PASSWORD_MAX_LENGTH)


class PasswordSetRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    current_password: str | None = Field(
        default=None,
        max_length=PASSWORD_MAX_LENGTH,
        serialization_alias="currentPassword",
        validation_alias="currentPassword",
    )
    new_password: str = Field(
        max_length=PASSWORD_MAX_LENGTH,
        serialization_alias="newPassword",
        validation_alias="newPassword",
    )


class PasswordCredentialResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    enabled: bool
    set_at: str | None = Field(default=None, serialization_alias="setAt")


class AccountReadinessResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    product_ready: bool = Field(serialization_alias="productReady")
    missing_requirements: list[str] = Field(serialization_alias="missingRequirements")
    github_identity_id: str | None = Field(serialization_alias="githubIdentityId")
    github_grant_status: str | None = Field(serialization_alias="githubGrantStatus")


class AuthSessionResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    access_token: str = Field(serialization_alias="accessToken")
    refresh_token: str | None = Field(default=None, serialization_alias="refreshToken")
    token_type: Literal["bearer"] = Field(default="bearer", serialization_alias="tokenType")
    expires_in: int = Field(serialization_alias="expiresIn")
    user: UserRead
    readiness: AccountReadinessResponse
