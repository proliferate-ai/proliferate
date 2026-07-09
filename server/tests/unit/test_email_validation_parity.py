"""Write/read email validation parity (#1012).

Account creation used to validate email syntax with a permissive regex, while
``UserRead`` (via ``fastapi_users.schemas.BaseUser``) validates with pydantic's
``EmailStr``, which rejects IANA special-use/reserved TLDs such as ``.test``,
``.invalid``, and ``.localhost``. The write path accepted
``someone@example.test``; the read path then raised a ``ValidationError`` while
serializing the response, so ``GET /users/me`` 500ed for an account the
product itself had just created.

The fix is two-sided:

- ``normalize_account_email`` (the shared write path for the first-run claim
  and invited self-registration) now validates with the same ``EmailStr``
  rules, so it can no longer create an account the read model would refuse to
  serialize.
- ``UserRead.email`` is widened from the inherited ``EmailStr`` to plain
  ``str`` so it always serializes, regardless of how a row reached the table
  (OAuth/SSO provider-supplied emails, or any row already in the database from
  before this fix existed).

These tests assert that agreement directly: creating an account with a
reserved-TLD email must fail cleanly at creation (never write a row an
authenticated user can't read back), and any email already stored -- however
it got there -- must always serialize through ``UserRead`` without raising.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.auth.identity.store import create_auth_user
from proliferate.auth.models import UserRead
from proliferate.auth.passwords import hash_password
from proliferate.db.store.auth_passwords import update_user_password_hash
from proliferate.server.setup.accounts import AccountValidationError, normalize_account_email

PASSWORD = "a-strong-enough-password"
LOGIN_PATH = "/auth/desktop/password/login"


# ---------------------------------------------------------------------------
# Write path: normalize_account_email rejects what the read model can't
# serialize.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "email",
    [
        "someone@example.test",
        "someone@foo.invalid",
        "someone@foo.localhost",
    ],
)
def test_normalize_account_email_rejects_reserved_tlds(email: str) -> None:
    with pytest.raises(AccountValidationError):
        normalize_account_email(email)


@pytest.mark.parametrize(
    "email",
    [
        "someone@example.com",
        "someone@acme.example.com",
    ],
)
def test_normalize_account_email_accepts_real_shaped_domains(email: str) -> None:
    assert normalize_account_email(email) == email.lower()


# ---------------------------------------------------------------------------
# Read path: UserRead must serialize any row already in the table, including
# rows that did not go through normalize_account_email (OAuth/SSO-provisioned,
# or written before this fix existed).
# ---------------------------------------------------------------------------


async def test_user_read_serializes_reserved_tld_email(test_engine) -> None:
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    async with factory() as session:
        user = await create_auth_user(
            session,
            email="legacy@acme.test",
            display_name=None,
            avatar_url=None,
        )
        await session.commit()

    # This is the exact call proliferate.auth.profile_api.current_user_profile
    # makes for GET /users/me. Before the fix this raised a pydantic
    # ValidationError (-> unhandled 500); it must now succeed.
    user_read = UserRead.model_validate(user)
    assert user_read.email == "legacy@acme.test"


async def test_get_users_me_never_500s_for_reserved_tld_account(client, test_engine) -> None:
    """End-to-end regression for the issue's exact repro.

    ``normalize_account_email`` now refuses to create a ``.test`` account
    through the product's own registration surfaces, so this simulates the
    one remaining way such a row can exist -- provisioned directly (as an
    OAuth/SSO arrival would be, or as a row already in the database from
    before this fix existed) -- and asserts the read side still never 500s.
    """
    email = "someone@example.test"
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    async with factory() as session:
        user = await create_auth_user(session, email=email, display_name=None, avatar_url=None)
        await update_user_password_hash(
            session,
            user_id=user.id,
            hashed_password=hash_password(PASSWORD),
            password_set_at=datetime.now(UTC),
        )
        await session.commit()

    login = await client.post(LOGIN_PATH, json={"email": email, "password": PASSWORD})
    assert login.status_code == 200
    access_token = login.json()["access_token"]

    me = await client.get("/users/me", headers={"Authorization": f"Bearer {access_token}"})
    assert me.status_code == 200
    assert me.json()["email"] == email
