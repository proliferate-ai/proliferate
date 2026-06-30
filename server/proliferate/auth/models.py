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
    display_name: str | None = None
    github_login: str | None = None
    avatar_url: str | None = None
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
