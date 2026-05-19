"""Auth service helpers shared by web and mobile auth surfaces."""

from __future__ import annotations

from proliferate.auth.identity import (
    AUTH_PROVIDERS,
    AuthProvider,
    first_account_for_provider,
    onboarding_state_for_user,
    user_has_product_identity,
)
from proliferate.auth.models import (
    AuthLinkedProvider,
    AuthProviderAvailability,
    AuthViewerResponse,
    UserRead,
)
from proliferate.config import settings
from proliferate.db.models.auth import OAuthAccount, User


def auth_viewer_payload(user: User) -> AuthViewerResponse:
    accounts = list(user.oauth_accounts or [])
    return AuthViewerResponse(
        user=UserRead.model_validate(user),
        github_connected=user_has_product_identity(user),
        onboarding_state=onboarding_state_for_user(user),
        linked_providers=[
            _linked_provider_payload(provider, accounts) for provider in AUTH_PROVIDERS
        ],
        provider_availability=[
            _provider_availability_payload(provider) for provider in AUTH_PROVIDERS
        ],
    )


def _linked_provider_payload(
    provider: AuthProvider,
    accounts: list[OAuthAccount],
) -> AuthLinkedProvider:
    account = first_account_for_provider(accounts, provider)
    return AuthLinkedProvider(
        provider=provider,
        connected=account is not None,
        account_email=account.account_email if account is not None else None,
        account_id=account.account_id if account is not None else None,
    )


def _provider_availability_payload(provider: AuthProvider) -> AuthProviderAvailability:
    match provider:
        case "github":
            enabled = bool(settings.github_oauth_client_id and settings.github_oauth_client_secret)
            reason = None if enabled else "not_configured"
        case "google":
            enabled = bool(settings.google_oauth_client_id and settings.google_oauth_client_secret)
            reason = None if enabled else "not_configured"
        case "apple":
            enabled = False
            reason = "not_supported"
    return AuthProviderAvailability(provider=provider, enabled=enabled, reason=reason)
