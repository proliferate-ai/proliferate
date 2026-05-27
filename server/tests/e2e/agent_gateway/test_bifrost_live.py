from __future__ import annotations

import os
import time
import uuid
from decimal import Decimal

import httpx
import pytest

from proliferate.integrations.bifrost import BifrostAdminClient


pytestmark = pytest.mark.live_bifrost


def _live_bifrost_configured() -> bool:
    return os.environ.get("RUN_LIVE_BIFROST") == "1"


def _bifrost_base_url() -> str:
    return (
        os.environ.get("PHASE0_BIFROST_BASE_URL")
        or os.environ.get("AGENT_GATEWAY_BIFROST_BASE_URL")
        or ""
    ).rstrip("/")


def _openai_api_key() -> str:
    return os.environ.get("PHASE0_BIFROST_OPENAI_API_KEY") or os.environ.get(
        "OPENAI_API_KEY",
        "",
    )


@pytest.mark.asyncio
async def test_live_bifrost_virtual_key_routes_request_and_records_cost() -> None:
    if not _live_bifrost_configured():
        pytest.skip("Set RUN_LIVE_BIFROST=1 to run the live Bifrost proof.")
    base_url = _bifrost_base_url()
    api_key = _openai_api_key()
    if not base_url or not api_key:
        pytest.skip("Set PHASE0_BIFROST_BASE_URL and OPENAI_API_KEY for live Bifrost.")

    model = os.environ.get("PHASE0_BIFROST_OPENAI_MODEL", "gpt-4o-mini")
    key_id = f"proliferate-live-test-{uuid.uuid4().hex[:10]}"
    virtual_key_id: str | None = None
    client = BifrostAdminClient(
        base_url=base_url,
        admin_token=os.environ.get("PHASE0_BIFROST_ADMIN_TOKEN")
        or os.environ.get("AGENT_GATEWAY_BIFROST_ADMIN_TOKEN"),
    )

    try:
        provider_key = await client.upsert_provider_key(
            provider="openai",
            key_id=key_id,
            name="Proliferate live Bifrost test",
            value=api_key,
            models=(model,),
        )
        virtual_key = await client.create_virtual_key(
            name=f"proliferate-live-test-{key_id}",
            description="Proliferate live Bifrost cost-tracking proof",
            provider_configs=[
                {
                    "provider": "openai",
                    "weight": 1.0,
                    "allowed_models": [model],
                    "blacklisted_models": [],
                    "key_ids": [provider_key.key_id],
                    "budgets": [{"max_limit": 0.01, "reset_duration": "100Y"}],
                }
            ],
            budgets=[],
            is_active=True,
        )
        virtual_key_id = virtual_key.virtual_key_id
        assert virtual_key.virtual_key

        async with httpx.AsyncClient(timeout=60) as http:
            response = await http.post(
                f"{base_url}/v1/chat/completions",
                headers={"Authorization": f"Bearer {virtual_key.virtual_key}"},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": "Reply OK."}],
                    "max_tokens": 2,
                },
            )
        assert response.status_code == 200, response.text[:500]

        matching_log = None
        for _attempt in range(15):
            logs = await client.list_logs(
                virtual_key_ids=(virtual_key_id,),
                limit=20,
                order="desc",
            )
            matching_log = next(
                (
                    log
                    for log in logs.logs
                    if log.virtual_key_id == virtual_key_id and log.cost is not None
                ),
                None,
            )
            if matching_log is not None:
                break
            time.sleep(1)

        assert matching_log is not None
        assert matching_log.provider == "openai"
        assert matching_log.selected_key_id == provider_key.key_id
        assert matching_log.cost is not None
        assert Decimal(matching_log.cost) >= Decimal("0")
    finally:
        if virtual_key_id is not None:
            await client.disable_virtual_key(virtual_key_id)
        await client.disable_provider_key(provider="openai", key_id=key_id)
