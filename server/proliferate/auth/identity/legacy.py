"""Temporary compatibility helpers for legacy OAuthAccount callers."""

from __future__ import annotations

from collections.abc import Iterable

from proliferate.auth.identity.types import (
    AUTH_PROVIDERS,
    PRODUCT_IDENTITY_PROVIDER,
    AuthProviderName,
    OnboardingState,
)
from proliferate.db.models.auth import OAuthAccount, User


def oauth_accounts_for_user(user: User) -> list[OAuthAccount]:
    return list(user.oauth_accounts or [])


def normalize_oauth_name(oauth_name: str) -> AuthProviderName | None:
    if oauth_name in AUTH_PROVIDERS:
        return oauth_name
    return None


def linked_provider_names(user: User) -> set[AuthProviderName]:
    names: set[AuthProviderName] = set()
    for account in oauth_accounts_for_user(user):
        provider = normalize_oauth_name(account.oauth_name)
        if provider is not None:
            names.add(provider)
    return names


def user_has_provider(user: User, provider: AuthProviderName) -> bool:
    return provider in linked_provider_names(user)


def user_has_product_identity(user: User) -> bool:
    return user_has_provider(user, PRODUCT_IDENTITY_PROVIDER)


def onboarding_state_for_user(user: User) -> OnboardingState:
    if user_has_product_identity(user):
        return "active"
    return "needs_github"


def first_account_for_provider(
    accounts: Iterable[OAuthAccount],
    provider: AuthProviderName,
) -> OAuthAccount | None:
    for account in accounts:
        if account.oauth_name == provider:
            return account
    return None
