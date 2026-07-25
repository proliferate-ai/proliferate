"""Password credential helpers for product auth surfaces."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi_users.password import PasswordHelper
from pwdlib.exceptions import UnknownHashError

from proliferate.constants.auth import PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH

_password_helper = PasswordHelper()
_dummy_password_hash: str | None = None
_DUMMY_PASSWORD = "not a real proliferate password"


class PasswordValidationError(ValueError):
    """Raised when a proposed password fails product validation."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class PasswordVerification:
    verified: bool
    updated_hash: str | None


def normalize_password_email(email: str) -> str:
    return email.strip().lower()


def validate_new_password(password: str) -> None:
    if len(password) < PASSWORD_MIN_LENGTH:
        raise PasswordValidationError(
            f"Password must be at least {PASSWORD_MIN_LENGTH} characters."
        )
    if len(password) > PASSWORD_MAX_LENGTH:
        raise PasswordValidationError(
            f"Password must be at most {PASSWORD_MAX_LENGTH} characters."
        )
    if not password.strip():
        raise PasswordValidationError("Password cannot be blank.")


def hash_password(password: str) -> str:
    validate_new_password(password)
    return _password_helper.hash(password)


def verify_password(password: str, hashed_password: str) -> PasswordVerification:
    try:
        verified, updated_hash = _password_helper.verify_and_update(
            password,
            hashed_password,
        )
    except UnknownHashError:
        return PasswordVerification(verified=False, updated_hash=None)
    return PasswordVerification(verified=verified, updated_hash=updated_hash)


def harden_password_failure(password: str) -> None:
    """Run a real password verification for accounts that cannot authenticate."""

    try:
        _password_helper.verify_and_update(password, _get_dummy_password_hash())
    except UnknownHashError:
        return


def _get_dummy_password_hash() -> str:
    global _dummy_password_hash
    if _dummy_password_hash is None:
        _dummy_password_hash = _password_helper.hash(_DUMMY_PASSWORD)
    return _dummy_password_hash
