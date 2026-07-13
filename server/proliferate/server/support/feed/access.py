"""Support feed access dependency.

The feed uses a dedicated Bearer key, separate from employee/web/agent auth.
The key is compared in constant time. An unset key rejects every request so the
route is dark-deployable: it exists but is unusable until the key is provisioned.
"""

from __future__ import annotations

import hmac

from fastapi import Header

from proliferate.config import settings
from proliferate.server.support.feed.errors import SupportFeedUnauthorized

_BEARER_PREFIX = "Bearer "


async def require_support_feed_key(
    authorization: str | None = Header(default=None),
) -> None:
    configured = settings.support_feed_bearer_token.strip()
    presented = _extract_bearer(authorization)
    # Constant-time comparison; an unset configured key never authenticates.
    if not configured or presented is None:
        raise SupportFeedUnauthorized()
    if not hmac.compare_digest(presented, configured):
        raise SupportFeedUnauthorized()


def _extract_bearer(authorization: str | None) -> str | None:
    if not authorization or not authorization.startswith(_BEARER_PREFIX):
        return None
    token = authorization[len(_BEARER_PREFIX) :].strip()
    return token or None
