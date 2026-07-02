"""Typed LiteLLM payload models exposed by the integration.

Pydantic is used (rather than plain dataclasses) because every payload here is
structured untrusted input parsed off the LiteLLM proxy wire.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class LiteLLMVirtualKey(BaseModel):
    """A virtual key minted by ``/key/generate``."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    key: str
    token_id: str = ""
    key_alias: str | None = None
    user_id: str | None = None
    team_id: str | None = None
    max_budget: float | None = None


class LiteLLMSpendLogEntry(BaseModel):
    """One per-request row from ``/spend/logs?summarize=false``.

    ``api_key`` is the SHA-256 token hash of the virtual key that made the
    request; it equals the ``token_id`` returned at mint time.
    """

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    request_id: str
    api_key: str = ""
    model: str = ""
    spend: float = 0.0
    total_tokens: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    start_time: str | None = Field(default=None, alias="startTime")
    end_time: str | None = Field(default=None, alias="endTime")
    team_id: str | None = None
    user: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
