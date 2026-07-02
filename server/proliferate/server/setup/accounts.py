"""Password account creation shared by the first-run claim and self-registration.

The first-run claim (A2) built the only server-side path that creates a product
account directly from an email and password. Invited self-registration (the
invite-as-allowlist flow) reuses exactly the same machinery, so both paths stay
byte-for-byte consistent: same email normalization, same password policy, same
``password_set_at`` marker semantics.

Validation failures raise ``AccountValidationError`` so each transport can map
them onto its own error shape (HTML form error for /setup, JSON error for the
registration route).
"""

from __future__ import annotations

import re
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.store import create_auth_user
from proliferate.auth.passwords import (
    PasswordValidationError,
    hash_password,
    normalize_password_email,
    validate_new_password,
)
from proliferate.db.models.auth import User
from proliferate.db.store.auth_passwords import update_user_password_hash

_EMAIL_PATTERN = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


class AccountValidationError(Exception):
    """The submitted email or password is not acceptable."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def normalize_account_email(email: str) -> str:
    """Normalize and validate an email for account creation."""
    normalized_email = normalize_password_email(email)
    if not _EMAIL_PATTERN.fullmatch(normalized_email):
        raise AccountValidationError("Enter a valid email address.")
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
