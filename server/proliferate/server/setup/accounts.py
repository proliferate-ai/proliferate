"""Password account creation shared by the first-run claim and self-registration.

The first-run claim (A2) built the only server-side path that creates a product
account directly from an email and password. Invited self-registration (the
invite-as-allowlist flow) reuses exactly the same machinery, so both paths stay
byte-for-byte consistent: same email normalization, same password policy, same
``password_set_at`` marker semantics.

Validation failures raise ``AccountValidationError`` so each transport can map
them onto its own error shape (HTML form error for /setup, JSON error for the
registration route).

Email syntax is validated with the same ``pydantic.EmailStr`` rules the read
model (``UserRead``, via ``fastapi_users.schemas.BaseUser``) used to enforce at
serialization time (see #1012): reserved/special-use TLDs such as ``.test``,
``.invalid``, ``.local``, and ``.localhost`` are rejected here, at creation,
with a clean 400/403 instead of being written and then 500ing on
``GET /users/me``.
"""

from __future__ import annotations

from datetime import UTC, datetime

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.store import create_auth_user
from proliferate.auth.passwords import (
    PasswordValidationError,
    hash_password,
    normalize_password_email,
    validate_new_password,
)
from proliferate.constants.auth import PASSWORD_EMAIL_MAX_LENGTH
from proliferate.db.models.auth import User
from proliferate.db.store.auth_passwords import update_user_password_hash

_email_syntax_adapter = TypeAdapter(EmailStr)


class AccountValidationError(Exception):
    """The submitted email or password is not acceptable."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def normalize_account_email(email: str) -> str:
    """Normalize and validate an email for account creation.

    The length cap matches the users email column (String(320)) so an
    oversized value fails validation here instead of blowing up on the insert.
    Syntax is checked with ``EmailStr`` so the write path can never accept an
    address the read model (``UserRead``) would refuse to serialize. Shared by
    the first-run claim and invited self-registration.
    """
    normalized_email = normalize_password_email(email)
    if len(normalized_email) > PASSWORD_EMAIL_MAX_LENGTH:
        raise AccountValidationError("Enter a valid email address.")
    try:
        _email_syntax_adapter.validate_python(normalized_email)
    except ValidationError as exc:
        raise AccountValidationError("Enter a valid email address.") from exc
    return normalized_email


def validate_account_password(password: str) -> None:
    try:
        validate_new_password(password)
    except PasswordValidationError as exc:
        raise AccountValidationError(exc.reason) from exc


async def create_password_account(
    db: AsyncSession,
    *,
    email: str,
    password: str,
) -> User:
    """Create an auth user with a password credential.

    ``email`` must already be normalized (``normalize_account_email``) and
    ``password`` validated (``validate_account_password``); this function only
    performs the writes so callers can run their checks before any mutation.
    """
    user = await create_auth_user(
        db,
        email=email,
        display_name=None,
        avatar_url=None,
    )
    await update_user_password_hash(
        db,
        user_id=user.id,
        hashed_password=hash_password(password),
        password_set_at=datetime.now(UTC),
    )
    return user
