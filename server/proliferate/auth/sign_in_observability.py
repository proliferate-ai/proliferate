"""Structured sign-in outcome logging for the sign-in success-rate SLI.

The token-exchange endpoints (`/auth/web/token`, `/auth/mobile/token`,
`/auth/desktop/token`) previously emitted no outcome log line at all — see
[[Observability Context]] section 4.3. This module is the single place that
emits one, so the CloudWatch metric filter and the field contract stay in
sync with the code that produces them.

Contract fields (stable; consumed by a CloudWatch Logs metric filter, see
`guides/operating/production-alerts.md#sign-in-success-rate`):

- `event`: always `"auth.sign_in.outcome"`
- `auth_sign_in_outcome`: `"success"` or `"failure"`
- `auth_sign_in_surface`: `"web"`, `"mobile"`, or `"desktop"`
- `auth_sign_in_failure_code`: the bounded `AuthFlowError.code` (failure only)

Never log the auth code, PKCE verifier, tokens, or the user's email — the
`AuthFlowError.code` values are already bounded, non-PII identifiers (e.g.
`identity_auth_code_invalid`, `desktop_pkce_verification_failed`).
"""

from __future__ import annotations

import logging

_logger = logging.getLogger("proliferate.auth.sign_in")

SignInSurface = str
_SURFACES = frozenset({"web", "mobile", "desktop"})


def _validate_surface(surface: SignInSurface) -> None:
    if surface not in _SURFACES:
        raise ValueError(f"unknown sign-in surface: {surface!r}")


def log_sign_in_success(surface: SignInSurface) -> None:
    """Record a successful token exchange for the sign-in success-rate SLI."""
    _validate_surface(surface)
    _logger.info(
        "auth sign-in succeeded",
        extra={
            "event": "auth.sign_in.outcome",
            "auth_sign_in_outcome": "success",
            "auth_sign_in_surface": surface,
        },
    )


def log_sign_in_failure(surface: SignInSurface, *, failure_code: str) -> None:
    """Record a failed token exchange for the sign-in success-rate SLI."""
    _validate_surface(surface)
    _logger.info(
        "auth sign-in failed",
        extra={
            "event": "auth.sign_in.outcome",
            "auth_sign_in_outcome": "failure",
            "auth_sign_in_surface": surface,
            "auth_sign_in_failure_code": failure_code,
        },
    )
