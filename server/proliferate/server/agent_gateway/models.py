"""Gateway service internal models."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class AuthorizedGatewayRequest:
    litellm_key: str
    agent_kind: str
    protocol_facade: str
    policy_id: UUID
    organization_id: UUID | None
    user_id: UUID | None
    target_id: UUID
    sandbox_profile_id: UUID
    allowed_model_ids: tuple[str, ...]


@dataclass(frozen=True)
class GatewayForwardResponse:
    status_code: int
    headers: dict[str, str]
    content: bytes


@dataclass(frozen=True)
class GatewayForwardStream:
    status_code: int
    headers: dict[str, str]
    chunks: AsyncIterator[bytes]


@dataclass(frozen=True)
class GatewayModelsResponse:
    protocol_facade: str
    model_ids: tuple[str, ...]
