"""Agent-auth domain errors."""

from __future__ import annotations

from proliferate.errors import ProliferateError


class AgentAuthError(ProliferateError):
    """Raised for agent-auth control-plane failures."""
