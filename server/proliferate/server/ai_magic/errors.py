from __future__ import annotations

from proliferate.errors import ProliferateError


class AiMagicError(ProliferateError):
    """Raised when an AI magic request fails with a client-facing error."""
