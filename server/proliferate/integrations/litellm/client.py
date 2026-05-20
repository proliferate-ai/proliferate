"""Async client for the private LiteLLM proxy."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import httpx

from proliferate.config import settings
from proliferate.integrations.litellm.errors import LiteLLMIntegrationError
from proliferate.integrations.litellm.models import (
    LiteLLMKeyResult,
    LiteLLMModelDeploymentResult,
    LiteLLMTeamResult,
)

_DEFAULT_TIMEOUT_SECONDS = 30.0


class LiteLLMAdminClient:
    """Thin wrapper around LiteLLM control-plane APIs used by provisioning."""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        master_key: str | None = None,
        timeout_seconds: float = _DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._base_url = (base_url or settings.agent_gateway_litellm_base_url).rstrip("/")
        self._master_key = (
            master_key if master_key is not None else settings.agent_gateway_litellm_master_key
        )
        self._timeout_seconds = timeout_seconds

    async def ensure_team(
        self,
        *,
        team_alias: str,
        team_id: str | None = None,
        max_budget: str | None = None,
        budget_duration: str | None = None,
    ) -> LiteLLMTeamResult:
        body: dict[str, Any] = {
            "team_alias": team_alias,
            "models": [],
        }
        if team_id:
            body["team_id"] = team_id
        if max_budget is not None:
            body["max_budget"] = float(max_budget)
        if budget_duration is not None:
            body["budget_duration"] = budget_duration
        path = "/team/update" if team_id else "/team/new"
        payload = await self._request("POST", path, json=body)
        return LiteLLMTeamResult(team_id=str(payload.get("team_id") or team_id or ""))

    async def generate_key(
        self,
        *,
        team_id: str,
        key_alias: str,
    ) -> LiteLLMKeyResult:
        payload = await self._request(
            "POST",
            "/key/generate",
            json={
                "team_id": team_id,
                "key_alias": key_alias,
            },
        )
        key = payload.get("key")
        if not isinstance(key, str) or not key:
            raise LiteLLMIntegrationError("LiteLLM did not return a virtual key.")
        key_id = payload.get("key_id") or payload.get("token_id")
        return LiteLLMKeyResult(key=key, key_id=str(key_id) if key_id else None)

    async def create_model_deployment(
        self,
        *,
        public_model_name: str,
        provider_model: str,
        team_id: str,
        litellm_params: Mapping[str, object],
        metadata: Mapping[str, object] | None = None,
    ) -> LiteLLMModelDeploymentResult:
        params = dict(litellm_params)
        params["model"] = provider_model
        payload = await self._request(
            "POST",
            "/model/new",
            json={
                "model_name": public_model_name,
                "litellm_params": params,
                "model_info": {
                    "team_id": team_id,
                    "metadata": dict(metadata or {}),
                },
            },
        )
        model_info = payload.get("model_info", {})
        model_id = model_info.get("id") if isinstance(model_info, dict) else None
        return LiteLLMModelDeploymentResult(
            model_id=str(model_id) if model_id else None,
            public_model_name=public_model_name,
            team_id=team_id,
        )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: Mapping[str, object] | None = None,
    ) -> dict[str, Any]:
        if not self._master_key:
            raise LiteLLMIntegrationError("LiteLLM master key is not configured.")
        request_json = dict(json or {})
        redaction_secrets = (self._master_key, *_collect_sensitive_values(request_json))
        async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
            try:
                response = await client.request(
                    method,
                    f"{self._base_url}{path}",
                    headers={"Authorization": f"Bearer {self._master_key}"},
                    json=request_json,
                )
            except httpx.HTTPError as exc:
                raise LiteLLMIntegrationError("Could not reach LiteLLM proxy.") from exc
        if response.status_code < 200 or response.status_code >= 300:
            detail = _redact(response.text, redaction_secrets)
            raise LiteLLMIntegrationError(
                f"LiteLLM request failed with HTTP {response.status_code}: {detail}",
                status_code=response.status_code,
            )
        payload = response.json() if response.content else {}
        if not isinstance(payload, dict):
            raise LiteLLMIntegrationError("LiteLLM response was not a JSON object.")
        return payload


def _redact(value: str, secrets: str | tuple[str | None, ...]) -> str:
    secret_values = (secrets,) if isinstance(secrets, str) else secrets
    for secret in secret_values:
        if secret:
            value = value.replace(secret, "[REDACTED]")
    return value[:1000]


def _collect_sensitive_values(value: object) -> tuple[str, ...]:
    found: list[str] = []

    def visit(item: object, *, key: str | None = None) -> None:
        if isinstance(item, Mapping):
            for child_key, child_value in item.items():
                visit(child_value, key=str(child_key).lower())
            return
        if isinstance(item, list | tuple):
            for child in item:
                visit(child, key=key)
            return
        if not isinstance(item, str) or not item:
            return
        if key is None:
            return
        if any(marker in key for marker in ("api_key", "token", "secret", "external_id")):
            found.append(item)

    visit(value)
    return tuple(found)
