"""Canonical auth identity types."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Literal
from uuid import UUID


class AuthProvider(StrEnum):
    GITHUB = "github"
    GOOGLE = "google"
    APPLE = "apple"


class AuthSurface(StrEnum):
    DESKTOP = "desktop"
    WEB = "web"
    MOBILE = "mobile"


class AuthPurpose(StrEnum):
    LOGIN = "login"
    LINK = "link"
    REQUIRED_GITHUB_LINK = "required_github_link"


class AuthProviderGrantStatus(StrEnum):
    READY = "ready"
    EXPIRED = "expired"
    REVOKED = "revoked"
    INVALID = "invalid"
    NEEDS_REAUTH = "needs_reauth"


AuthProviderName = Literal["github", "google", "apple"]
OnboardingState = Literal["needs_github", "active"]

AUTH_PROVIDERS: tuple[AuthProviderName, ...] = ("github", "google", "apple")
PRODUCT_IDENTITY_PROVIDER: AuthProviderName = "github"
REQUIRED_GITHUB_SCOPES = frozenset({"repo", "user", "user:email"})


@dataclass(frozen=True)
class VerifiedProviderIdentity:
    provider: AuthProviderName
    provider_subject: str
    email: str | None
    email_verified: bool
    display_name: str | None
    provider_login: str | None
    avatar_url: str | None
    access_token: str | None
    refresh_token: str | None
    expires_at: datetime | None
    expires_at_timestamp: int | None
    scopes: frozenset[str]


@dataclass(frozen=True)
class AccountReadiness:
    product_ready: bool
    missing_requirements: tuple[str, ...]
    github_identity_id: UUID | None
    github_grant_status: str | None


@dataclass(frozen=True)
class AuthChallengeSnapshot:
    id: UUID
    provider: AuthProviderName
    surface: str
    purpose: str
    user_id: UUID | None
    client_state: str
    code_challenge: str
    code_challenge_method: str
    redirect_uri: str
    nonce_hash: str


@dataclass(frozen=True)
class AuthSession:
    access_token: str
    refresh_token: str
    expires_in: int
    user_id: UUID
    email: str
    is_active: bool
    is_superuser: bool
    is_verified: bool
    display_name: str | None
    github_login: str | None
    avatar_url: str | None
    readiness: AccountReadiness
