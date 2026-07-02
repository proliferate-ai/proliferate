"""Public API for the LiteLLM proxy integration."""

from __future__ import annotations

from proliferate.integrations.litellm.client import (
    disable_virtual_key,
    ensure_team,
    ensure_user,
    health,
    list_models,
    mint_virtual_key,
    page_spend_logs,
    rotate_virtual_key,
    set_key_budget,
    update_team_budget,
)
from proliferate.integrations.litellm.errors import LiteLLMIntegrationError
from proliferate.integrations.litellm.models import LiteLLMSpendLogEntry, LiteLLMVirtualKey

__all__ = [
    "LiteLLMIntegrationError",
    "LiteLLMSpendLogEntry",
    "LiteLLMVirtualKey",
    "disable_virtual_key",
    "ensure_team",
    "ensure_user",
    "health",
    "list_models",
    "mint_virtual_key",
    "page_spend_logs",
    "rotate_virtual_key",
    "set_key_budget",
    "update_team_budget",
]
