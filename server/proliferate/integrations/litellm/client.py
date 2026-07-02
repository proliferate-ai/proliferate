"""LiteLLM proxy admin HTTP client.

Coarse operations only, per the agent-auth-litellm spec (section 2.2). This is
the single module that knows LiteLLM endpoint paths; product services call the
public functions re-exported from ``proliferate.integrations.litellm``.

Verified against ghcr.io/berriai/litellm:main-stable:

- ``/team/new`` does NOT enforce unique ``team_alias``. The pinned image also
  ignores the ``team_alias`` query param on ``/team/list`` and returns *all*
  teams (fully hydrated), so ``ensure_team`` must filter client-side and treat
  alias uniqueness as an invariant *we* enforce (the enrollment writer is the
  single writer per billing subject), not something LiteLLM guarantees. Prefer
  the stored-id path (``ensure_team(team_id=...)``) to skip the listing entirely.
- ``/user/new`` returns 409 for an existing ``user_id``.
- ``/key/generate`` enforces unique ``key_alias`` (400 on duplicate).
- ``/key/regenerate`` is an Enterprise-only feature on the OSS image (returns
  500 with an "Enterprise feature" message) — rotation is implemented as
  delete + mint instead.
- ``/key/block`` takes the raw ``sk-...`` key or the token hash and is
  immediately enforced (401 on the data plane).
- ``/spend/logs?summarize=false`` returns per-request rows whose ``api_key``
  field is the key's token hash (== ``token_id`` from mint time).
"""

from __future__ import annotations

from typing import Any

import httpx
from pydantic import BaseModel, ValidationError

from proliferate.config import settings
from proliferate.integrations.litellm.errors import LiteLLMIntegrationError
from proliferate.integrations.litellm.models import LiteLLMSpendLogEntry, LiteLLMVirtualKey


def _base_url() -> str:
    base_url = settings.agent_gateway_litellm_base_url.rstrip("/")
    if not base_url:
        raise LiteLLMIntegrationError(
            "litellm_unconfigured",
            "LiteLLM base URL is not configured.",
            status_code=503,
        )
    return base_url


def _admin_headers() -> dict[str, str]:
    master_key = settings.agent_gateway_litellm_master_key
    if not master_key:
        raise LiteLLMIntegrationError(
            "litellm_unconfigured",
            "LiteLLM master key is not configured.",
            status_code=503,
        )
    return {"Authorization": f"Bearer {master_key}"}


async def _request(
    method: str,
    path: str,
    *,
    headers: dict[str, str],
    json_body: dict[str, Any] | None = None,
    params: dict[str, str] | None = None,
) -> Any:
    try:
        async with httpx.AsyncClient(
            timeout=settings.agent_gateway_litellm_timeout_seconds
        ) as client:
            response = await client.request(
                method,
                f"{_base_url()}{path}",
                headers=headers,
                json=json_body,
                params=params,
            )
    except httpx.HTTPError as exc:
        raise LiteLLMIntegrationError(
            "litellm_request_failed",
            "Could not reach the LiteLLM proxy. Check the gateway configuration and network.",
        ) from exc
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if response.status_code >= 400:
        message = "LiteLLM request failed."
        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict) and isinstance(error.get("message"), str):
                message = error["message"]
            elif isinstance(payload.get("detail"), str):
                message = payload["detail"]
        raise LiteLLMIntegrationError(
            "litellm_request_failed",
            message,
            status_code=response.status_code,
        )
    return payload


async def _admin_request(
    method: str,
    path: str,
    *,
    json_body: dict[str, Any] | None = None,
    params: dict[str, str] | None = None,
) -> Any:
    return await _request(
        method, path, headers=_admin_headers(), json_body=json_body, params=params
    )


def _require_dict(payload: Any, *, context: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise LiteLLMIntegrationError(
            "litellm_invalid_response",
            f"LiteLLM returned an invalid response for {context}.",
        )
    return payload


def _validate[ModelT: BaseModel](model: type[ModelT], payload: Any, *, context: str) -> ModelT:
    """Parse ``payload`` into ``model``, wrapping pydantic errors.

    A malformed 200 body (right status, wrong shape) otherwise surfaces as a raw
    ``pydantic.ValidationError`` and bypasses ``LiteLLMIntegrationError`` handling.
    """
    try:
        return model.model_validate(payload)
    except ValidationError as exc:
        raise LiteLLMIntegrationError(
            "litellm_invalid_response",
            f"LiteLLM returned a malformed response for {context}.",
        ) from exc


async def ensure_team(
    *, alias: str, team_id: str | None = None, max_budget: float | None = None
) -> str:
    """Return the team id for ``alias``, creating the team if it does not exist.

    If ``team_id`` is supplied (the caller persisted it on a previous success),
    reuse it directly — this is the durable get-or-create path and it avoids the
    check-then-create race entirely. Duplicate-team prevention relies on the
    enrollment writer being the single writer per billing subject and passing
    back the stored id; the alias listing below is only the first-create path.

    LiteLLM allows duplicate team aliases and the pinned image ignores the
    ``team_alias`` query param, returning all teams, so we filter client-side.
    """
    if team_id:
        return team_id
    existing = await _admin_request("GET", "/team/list", params={"team_alias": alias})
    if isinstance(existing, list):
        for team in existing:
            if isinstance(team, dict) and team.get("team_alias") == alias:
                team_id = team.get("team_id")
                if isinstance(team_id, str) and team_id:
                    return team_id
    body: dict[str, Any] = {"team_alias": alias}
    if max_budget is not None:
        body["max_budget"] = max_budget
    created = _require_dict(
        await _admin_request("POST", "/team/new", json_body=body), context="/team/new"
    )
    team_id = created.get("team_id")
    if not isinstance(team_id, str) or not team_id:
        raise LiteLLMIntegrationError(
            "litellm_invalid_response", "LiteLLM did not return a team id."
        )
    return team_id


async def ensure_user(*, user_id: str) -> str:
    """Create the LiteLLM user if missing; a 409 means it already exists."""
    try:
        await _admin_request(
            "POST",
            "/user/new",
            json_body={"user_id": user_id, "auto_create_key": False},
        )
    except LiteLLMIntegrationError as exc:
        if exc.status_code != 409:
            raise
    return user_id


async def mint_virtual_key(
    *,
    user_id: str,
    team_id: str | None = None,
    alias: str | None = None,
    max_budget: float | None = None,
    metadata: dict[str, Any] | None = None,
) -> LiteLLMVirtualKey:
    """Mint a virtual key. ``alias`` must be globally unique in LiteLLM."""
    body: dict[str, Any] = {"user_id": user_id}
    if team_id is not None:
        body["team_id"] = team_id
    if alias is not None:
        body["key_alias"] = alias
    if max_budget is not None:
        body["max_budget"] = max_budget
    if metadata is not None:
        body["metadata"] = metadata
    payload = _require_dict(
        await _admin_request("POST", "/key/generate", json_body=body),
        context="/key/generate",
    )
    key = _validate(LiteLLMVirtualKey, payload, context="/key/generate")
    if not key.key:
        raise LiteLLMIntegrationError(
            "litellm_invalid_response", "LiteLLM did not return a virtual key."
        )
    return key


async def rotate_virtual_key(
    *,
    key_or_token_id: str,
    user_id: str,
    team_id: str | None = None,
    alias: str | None = None,
    max_budget: float | None = None,
    metadata: dict[str, Any] | None = None,
) -> LiteLLMVirtualKey:
    """Replace a virtual key with a freshly minted one.

    ``/key/regenerate`` is Enterprise-only on the OSS LiteLLM image, so
    rotation is delete-then-mint. Delete (rather than block) frees the key
    alias for reuse by the replacement key. The old key stops working the
    moment the delete lands.

    A 404 on the delete means the key is already gone (e.g. a previous attempt
    deleted it but failed before minting). Treat that as success so a retry is
    idempotent and proceeds to mint instead of looping on the delete forever.
    """
    try:
        await _admin_request("POST", "/key/delete", json_body={"keys": [key_or_token_id]})
    except LiteLLMIntegrationError as exc:
        if exc.status_code != 404:
            raise
    return await mint_virtual_key(
        user_id=user_id,
        team_id=team_id,
        alias=alias,
        max_budget=max_budget,
        metadata=metadata,
    )


async def disable_virtual_key(*, key_or_token_id: str) -> None:
    """Block a virtual key; enforcement on the data plane is immediate."""
    await _admin_request("POST", "/key/block", json_body={"key": key_or_token_id})


async def set_key_budget(*, key_or_token_id: str, max_budget: float) -> None:
    """Set the max budget (USD) on a virtual key."""
    await _admin_request(
        "POST",
        "/key/update",
        json_body={"key": key_or_token_id, "max_budget": max_budget},
    )


async def update_team_budget(*, team_id: str, max_budget: float) -> None:
    """Set the max budget (USD) on a team."""
    await _admin_request(
        "POST",
        "/team/update",
        json_body={"team_id": team_id, "max_budget": max_budget},
    )


async def list_models(*, virtual_key: str) -> list[str]:
    """List model ids visible to ``virtual_key`` (not the master key)."""
    payload = _require_dict(
        await _request(
            "GET",
            "/v1/models",
            headers={"Authorization": f"Bearer {virtual_key}"},
        ),
        context="/v1/models",
    )
    data = payload.get("data")
    if not isinstance(data, list):
        raise LiteLLMIntegrationError(
            "litellm_invalid_response", "LiteLLM returned an invalid model list."
        )
    return [
        item["id"] for item in data if isinstance(item, dict) and isinstance(item.get("id"), str)
    ]


async def page_spend_logs(*, start_date: str, end_date: str) -> list[LiteLLMSpendLogEntry]:
    """Fetch per-request spend rows for the date window (YYYY-MM-DD, inclusive)."""
    payload = await _admin_request(
        "GET",
        "/spend/logs",
        params={
            "summarize": "false",
            "start_date": start_date,
            "end_date": end_date,
        },
    )
    if not isinstance(payload, list):
        raise LiteLLMIntegrationError(
            "litellm_invalid_response", "LiteLLM returned invalid spend logs."
        )
    return [
        _validate(LiteLLMSpendLogEntry, row, context="/spend/logs")
        for row in payload
        if isinstance(row, dict)
    ]


async def health() -> bool:
    """Liveness probe. Raises LiteLLMIntegrationError when unreachable."""
    await _request("GET", "/health/liveliness", headers={})
    return True
