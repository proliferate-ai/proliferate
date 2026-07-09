"""Auth request/response schemas."""

import uuid
from enum import StrEnum
from typing import Literal

from fastapi_users import schemas
from pydantic import BaseModel, ConfigDict, Field


class UserRole(StrEnum):
    USER = "user"
    ADMIN = "admin"


class UserRead(schemas.BaseUser[uuid.UUID]):
    # Overrides the inherited ``email: EmailStr`` (fastapi_users.schemas.BaseUser).
    # Account creation validates the email strictly with EmailStr rules (see
    # proliferate.server.setup.accounts.normalize_account_email), but this is
    # the *read* model: it must still serialize any email already stored,
    # including rows written before that write-side validation existed or via
    # a path (OAuth/SSO, direct fixtures) that does not go through it. #1012
    # was exactly this — EmailStr rejects reserved TLDs like ``.test`` at
    # serialization time, 500ing GET /users/me for an account the product
    # itself created.
    email: str
    display_name: str | None = None
    github_login: str | None = None
    avatar_url: str | None = None
    outreach_email: str | None = None
    role: UserRole = UserRole.USER


class UserCreate(schemas.BaseUserCreate):
    display_name: str | None = None


AuthProviderName = Literal["github", "google", "apple"]
AuthLinkedProviderName = Literal["github", "google", "apple", "sso"]
AuthOnboardingState = Literal["needs_github", "active"]


class AuthLinkedProvider(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    provider: AuthLinkedProviderName
    connected: bool
    account_email: str | None = Field(default=None, serialization_alias="accountEmail")
    account_id: str | None = Field(default=None, serialization_alias="accountId")
    display_name: str | None = Field(default=None, serialization_alias="displayName")
    brand_label: str | None = Field(default=None, serialization_alias="brandLabel")


class AuthProviderAvailability(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    provider: AuthProviderName
    enabled: bool
    reason: str | None = None


class AuthPasswordCredential(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    enabled: bool
    set_at: str | None = Field(default=None, serialization_alias="setAt")


class AuthViewerResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    user: UserRead
    github_connected: bool = Field(serialization_alias="githubConnected")
    onboarding_state: AuthOnboardingState = Field(serialization_alias="onboardingState")
    linked_providers: list[AuthLinkedProvider] = Field(serialization_alias="linkedProviders")
    provider_availability: list[AuthProviderAvailability] = Field(
        serialization_alias="providerAvailability"
    )
    password_credential: AuthPasswordCredential = Field(serialization_alias="passwordCredential")
