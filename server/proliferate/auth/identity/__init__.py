"""Product identity helpers and canonical provider constants."""

from proliferate.auth.identity.legacy import (
    first_account_for_provider,
    linked_provider_names,
    normalize_oauth_name,
    oauth_accounts_for_user,
    onboarding_state_for_user,
    user_has_product_identity,
    user_has_provider,
)
from proliferate.auth.identity.types import (
    AUTH_PROVIDERS,
    PRODUCT_IDENTITY_PROVIDER,
    AuthProvider,
    AuthProviderGrantStatus,
    AuthPurpose,
    AuthSurface,
    OnboardingState,
)

__all__ = [
    "AUTH_PROVIDERS",
    "PRODUCT_IDENTITY_PROVIDER",
    "AuthProvider",
    "AuthProviderGrantStatus",
    "AuthPurpose",
    "AuthSurface",
    "OnboardingState",
    "first_account_for_provider",
    "linked_provider_names",
    "normalize_oauth_name",
    "oauth_accounts_for_user",
    "onboarding_state_for_user",
    "user_has_product_identity",
    "user_has_provider",
]
