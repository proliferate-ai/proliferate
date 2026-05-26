"""Async client for Bifrost control-plane APIs."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from proliferate.config import settings
from proliferate.integrations.bifrost.errors import BifrostIntegrationError
from proliferate.integrations.bifrost.models import (
    BifrostLogEntry,
    BifrostLogSearchResult,
    BifrostProviderKeyResult,
    BifrostVirtualKeyResult,
)


class BifrostAdminClient:
    """Thin wrapper around Bifrost management APIs used by provisioning."""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        admin_token: str | None = None,
        timeout_seconds: float | None = None,
    ) -> None:
        self._base_url = (base_url or settings.agent_gateway_bifrost_base_url).rstrip("/")
        self._admin_token = (
            admin_token
            if admin_token is not None
            else settings.agent_gateway_bifrost_admin_token
        )
        self._timeout_seconds = (
            timeout_seconds
            if timeout_seconds is not None
            else settings.agent_gateway_bifrost_request_timeout_seconds
        )

    async def ensure_provider(self, provider: str) -> None:
        response = await self._request(
            "GET",
            f"/api/providers/{provider}",
            expected_statuses={200, 404},
        )
        if response is not None:
            return
        await self._request("POST", "/api/providers", json={"provider": provider})

    async def upsert_provider_key(
        self,
        *,
        provider: str,
        key_id: str,
        name: str,
        value: str | None,
        models: Sequence[str],
        aliases: Mapping[str, str] | None = None,
        bedrock_key_config: Mapping[str, object] | None = None,
        enabled: bool = True,
    ) -> BifrostProviderKeyResult:
        await self.ensure_provider(provider)
        body: dict[str, Any] = {
            "id": key_id,
            "name": name,
            "models": list(models),
            "blacklisted_models": [],
            "weight": 1.0,
            "aliases": dict(aliases or {}),
            "enabled": enabled,
        }
        if value is not None:
            body["value"] = _env_var(value)
        if bedrock_key_config is not None:
            body["bedrock_key_config"] = dict(bedrock_key_config)

        existing = await self._request(
            "GET",
            f"/api/providers/{provider}/keys/{key_id}",
            expected_statuses={200, 404},
        )
        if existing is None:
            payload = await self._request(
                "POST",
                f"/api/providers/{provider}/keys",
                json=body,
            )
        else:
            payload = await self._request(
                "PUT",
                f"/api/providers/{provider}/keys/{key_id}",
                json=body,
            )
        if not isinstance(payload, dict):
            raise BifrostIntegrationError("Bifrost provider-key response was invalid.")
        return BifrostProviderKeyResult(
            key_id=str(payload.get("id") or key_id),
            provider=provider,
            name=str(payload.get("name")) if payload.get("name") else name,
        )

    async def create_virtual_key(
        self,
        *,
        name: str,
        description: str,
        provider_configs: Sequence[Mapping[str, object]],
        budgets: Sequence[Mapping[str, object]] = (),
        is_active: bool = True,
        team_id: str | None = None,
        customer_id: str | None = None,
        calendar_aligned: bool = False,
    ) -> BifrostVirtualKeyResult:
        body: dict[str, Any] = {
            "name": name,
            "description": description,
            "provider_configs": [dict(config) for config in provider_configs],
            "budgets": [dict(budget) for budget in budgets],
            "is_active": is_active,
            "calendar_aligned": calendar_aligned,
        }
        if team_id is not None:
            body["team_id"] = team_id
        if customer_id is not None:
            body["customer_id"] = customer_id
        payload = await self._request(
            "POST",
            "/api/governance/virtual-keys",
            json=body,
        )
        return _virtual_key_result(payload)

    async def update_virtual_key(
        self,
        *,
        virtual_key_id: str,
        name: str,
        description: str,
        provider_configs: Sequence[Mapping[str, object]],
        budgets: Sequence[Mapping[str, object]] = (),
        is_active: bool = True,
        calendar_aligned: bool = False,
    ) -> BifrostVirtualKeyResult:
        payload = await self._request(
            "PUT",
            f"/api/governance/virtual-keys/{virtual_key_id}",
            json={
                "name": name,
                "description": description,
                "provider_configs": [dict(config) for config in provider_configs],
                "budgets": [dict(budget) for budget in budgets],
                "is_active": is_active,
                "calendar_aligned": calendar_aligned,
            },
        )
        return _virtual_key_result(payload)

    async def disable_virtual_key(self, virtual_key_id: str) -> None:
        await self._request(
            "PUT",
            f"/api/governance/virtual-keys/{virtual_key_id}",
            json={"is_active": False},
        )

    async def disable_provider_key(self, *, provider: str, key_id: str) -> None:
        payload = await self._request(
            "GET",
            f"/api/providers/{provider}/keys/{key_id}",
            expected_statuses={200, 404},
        )
        if payload is None:
            return
        payload["enabled"] = False
        await self._request(
            "PUT",
            f"/api/providers/{provider}/keys/{key_id}",
            json=payload,
        )

    async def list_logs(
        self,
        *,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        limit: int = 1000,
        offset: int = 0,
        order: str = "asc",
        virtual_key_ids: Sequence[str] = (),
    ) -> BifrostLogSearchResult:
        params: dict[str, str | int] = {
            "limit": min(max(limit, 1), 1000),
            "offset": max(offset, 0),
            "sort_by": "timestamp",
            "order": "asc" if order == "asc" else "desc",
        }
        if start_time is not None:
            params["start_time"] = start_time.isoformat()
        if end_time is not None:
            params["end_time"] = end_time.isoformat()
        if virtual_key_ids:
            params["virtual_key_ids"] = ",".join(virtual_key_ids)
        payload = await self._request("GET", "/api/logs", params=params)
        if not isinstance(payload, dict):
            raise BifrostIntegrationError("Bifrost logs response was invalid.")
        logs = payload.get("logs")
        if not isinstance(logs, list):
            logs = []
        pagination = payload.get("pagination")
        total_count = (
            int(pagination["total_count"])
            if isinstance(pagination, dict) and pagination.get("total_count") is not None
            else None
        )
        return BifrostLogSearchResult(
            logs=tuple(_log_entry(item) for item in logs if isinstance(item, dict)),
            total_count=total_count,
        )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: Mapping[str, object] | None = None,
        params: Mapping[str, str | int] | None = None,
        expected_statuses: set[int] | None = None,
    ) -> dict[str, Any] | None:
        expected = expected_statuses or set(range(200, 300))
        request_json = dict(json or {})
        redaction_secrets = (
            self._admin_token,
            *_collect_sensitive_values(request_json),
        )
        headers: dict[str, str] = {}
        if self._admin_token:
            headers["Authorization"] = f"Bearer {self._admin_token}"
        async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
            try:
                response = await client.request(
                    method,
                    f"{self._base_url}{path}",
                    headers=headers,
                    json=request_json if json is not None else None,
                    params=dict(params or {}),
                )
            except httpx.HTTPError as exc:
                raise BifrostIntegrationError("Could not reach Bifrost.") from exc
        if response.status_code == 404 and 404 in expected:
            return None
        if response.status_code not in expected:
            detail = _redact(response.text, redaction_secrets)
            raise BifrostIntegrationError(
                f"Bifrost request failed with HTTP {response.status_code}: {detail}",
                status_code=response.status_code,
            )
        if not response.content:
            return {}
        payload = response.json()
        if not isinstance(payload, dict):
            raise BifrostIntegrationError("Bifrost response was not a JSON object.")
        return payload


def _virtual_key_result(payload: dict[str, Any] | None) -> BifrostVirtualKeyResult:
    if not isinstance(payload, dict):
        raise BifrostIntegrationError("Bifrost virtual-key response was invalid.")
    virtual_key = payload.get("virtual_key")
    if not isinstance(virtual_key, dict):
        raise BifrostIntegrationError("Bifrost did not return a virtual key.")
    virtual_key_id = virtual_key.get("id")
    if not isinstance(virtual_key_id, str) or not virtual_key_id:
        raise BifrostIntegrationError("Bifrost virtual key was missing an id.")
    raw_value = virtual_key.get("value")
    return BifrostVirtualKeyResult(
        virtual_key_id=virtual_key_id,
        virtual_key=raw_value if isinstance(raw_value, str) and raw_value else None,
        name=str(virtual_key.get("name")) if virtual_key.get("name") else None,
        is_active=bool(virtual_key.get("is_active", True)),
    )


def _log_entry(payload: dict[str, Any]) -> BifrostLogEntry:
    token_usage = payload.get("token_usage")
    return BifrostLogEntry(
        log_id=str(payload.get("id") or ""),
        timestamp=_parse_datetime(payload.get("timestamp") or payload.get("created_at")),
        provider=str(payload.get("provider")) if payload.get("provider") else None,
        model=str(payload.get("model")) if payload.get("model") else None,
        status=str(payload.get("status")) if payload.get("status") else None,
        cost=_parse_decimal(payload.get("cost")),
        selected_key_id=(
            str(payload.get("selected_key_id")) if payload.get("selected_key_id") else None
        ),
        virtual_key_id=(
            str(payload.get("virtual_key_id")) if payload.get("virtual_key_id") else None
        ),
        token_usage=token_usage if isinstance(token_usage, dict) else {},
        raw=dict(payload),
    )


def _env_var(value: str) -> dict[str, object]:
    return {"value": value, "env_var": "", "from_env": False}


def bifrost_env_var(value: str) -> dict[str, object]:
    return _env_var(value)


def _parse_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _parse_decimal(value: object) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except InvalidOperation:
        return None


def _redact(value: str, secrets: str | Sequence[str | None]) -> str:
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
        if any(
            marker in key
            for marker in ("api_key", "apikey", "token", "secret", "external_id", "value")
        ):
            found.append(item)

    visit(value)
    return tuple(found)
