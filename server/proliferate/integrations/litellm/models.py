"""Typed LiteLLM integration payloads."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LiteLLMTeamResult:
    team_id: str


@dataclass(frozen=True)
class LiteLLMKeyResult:
    key: str
    key_id: str | None


@dataclass(frozen=True)
class LiteLLMModelDeploymentResult:
    model_id: str | None
    public_model_name: str
    team_id: str | None


@dataclass(frozen=True)
class LiteLLMCredentialResult:
    credential_name: str
