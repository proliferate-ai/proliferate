"""Shared token-generation helpers for session revocation.

``token_generation`` is a monotonic per-user counter (see ``db.models.auth.User``).
Every access and refresh token embeds the value current at mint time; on use the
embedded value is compared against the user's current generation and rejected on
mismatch. Bumping the counter (logout, password change) is what makes previously
issued tokens stop working — the server-side "revoke all sessions" primitive.

These helpers live in their own module so the JWT strategy, product session code,
and desktop auth code can all share them without import cycles.
"""

from __future__ import annotations

from collections.abc import Mapping

# Audience marker for the long-lived refresh tokens minted outside fastapi-users.
REFRESH_TOKEN_AUDIENCE = "proliferate:refresh"


def user_token_generation(user: object) -> int:
    """Return the user's current token generation, defaulting to 0."""
    return int(getattr(user, "token_generation", 0) or 0)


def claimed_token_generation(payload: Mapping[str, object]) -> int:
    """Return the ``token_generation`` claim from a decoded token payload.

    A missing claim maps to 0 so tokens minted before the claim existed keep
    working until the user's generation is first bumped. Any malformed claim
    maps to -1 so it can never accidentally equal a real generation.
    """
    value = payload.get("token_generation")
    if value is None:
        return 0
    # bool is an int subclass; a boolean claim is never a valid generation.
    if isinstance(value, bool):
        return -1
    if isinstance(value, int):
        return value
    return -1
