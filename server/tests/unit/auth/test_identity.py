import uuid

from proliferate.auth.identity import (
    onboarding_state_for_user,
    user_has_product_identity,
    user_has_provider,
)
from proliferate.db.models.auth import OAuthAccount, User


def _user_with_accounts(*oauth_names: str) -> User:
    user = User(
        id=uuid.uuid4(),
        email="identity@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    user.oauth_accounts = [
        OAuthAccount(
            user_id=user.id,
            oauth_name=oauth_name,
            access_token=f"{oauth_name}-access-token",
            account_id=f"{oauth_name}-account-id",
            account_email=f"{oauth_name}@example.com",
        )
        for oauth_name in oauth_names
    ]
    return user


def test_google_only_user_is_limited_until_github_is_connected() -> None:
    user = _user_with_accounts("google")

    assert user_has_provider(user, "google") is True
    assert user_has_product_identity(user) is False
    assert onboarding_state_for_user(user) == "needs_github"


def test_github_link_is_product_identity() -> None:
    user = _user_with_accounts("google", "github")

    assert user_has_provider(user, "github") is True
    assert user_has_product_identity(user) is True
    assert onboarding_state_for_user(user) == "active"
