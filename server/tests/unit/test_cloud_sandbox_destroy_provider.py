"""Tests for provider sandbox destruction in destroy_cloud_sandbox."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.server.cloud.cloud_sandboxes.service import destroy_cloud_sandbox


def _make_sandbox(
    *,
    e2b_sandbox_id: str | None = "provider-sandbox-789",
) -> CloudSandboxValue:
    now = datetime.now(tz=timezone.utc)
    return CloudSandboxValue(
        id=uuid4(),
        owner_scope="personal",
        owner_user_id=uuid4(),
        organization_id=None,
        created_by_user_id=uuid4(),
        billing_subject_id=uuid4(),
        status="ready",
        last_error=None,
        e2b_sandbox_id=e2b_sandbox_id,
        e2b_template_ref="e2b",
        anyharness_base_url="https://host.test",
        anyharness_bearer_token_ciphertext="enc-tok",
        anyharness_data_key_ciphertext="enc-key",
        runtime_generation=0,
        created_at=now,
        updated_at=now,
        ready_at=now,
        last_health_at=now,
        destroyed_at=None,
    )


@pytest.mark.asyncio
async def test_destroy_calls_provider_destroy() -> None:
    """destroy_cloud_sandbox must call provider.destroy_sandbox."""
    sandbox = _make_sandbox(e2b_sandbox_id="provider-sandbox-789")
    user = type("User", (), {"id": sandbox.owner_user_id})()

    provider = AsyncMock()
    provider.destroy_sandbox = AsyncMock()

    db = AsyncMock()

    with (
        patch(
            "proliferate.server.cloud.cloud_sandboxes.service.sandbox_store.load_personal_cloud_sandbox",
            new_callable=AsyncMock,
            return_value=sandbox,
        ),
        patch(
            "proliferate.server.cloud.cloud_sandboxes.service.runtime_workers_store.revoke_active_workers_for_identity",
            new_callable=AsyncMock,
        ),
        patch(
            "proliferate.server.cloud.cloud_sandboxes.service.sandbox_store.mark_cloud_sandbox_destroyed",
            new_callable=AsyncMock,
            return_value=sandbox,
        ) as mock_mark_destroyed,
        patch(
            "proliferate.server.cloud.cloud_sandboxes.service.get_sandbox_provider",
            return_value=provider,
        ),
    ):
        result = await destroy_cloud_sandbox(db, user)

    # Provider destroy was called with the correct sandbox id
    provider.destroy_sandbox.assert_awaited_once_with("provider-sandbox-789")
    # DB destroy still happened
    mock_mark_destroyed.assert_awaited_once_with(db, sandbox.id)
    assert result is not None


@pytest.mark.asyncio
async def test_destroy_proceeds_when_provider_destroy_fails() -> None:
    """If provider destroy fails, DB destroy must still complete (best-effort)."""
    sandbox = _make_sandbox(e2b_sandbox_id="provider-sandbox-789")
    user = type("User", (), {"id": sandbox.owner_user_id})()

    provider = AsyncMock()
    provider.destroy_sandbox = AsyncMock(side_effect=RuntimeError("E2B API down"))

    db = AsyncMock()

    with (
        patch(
            "proliferate.server.cloud.cloud_sandboxes.service.sandbox_store.load_personal_cloud_sandbox",
            new_callable=AsyncMock,
            return_value=sandbox,
        ),
        patch(
            "proliferate.server.cloud.cloud_sandboxes.service.runtime_workers_store.revoke_active_workers_for_identity",
            new_callable=AsyncMock,
        ),
        patch(
            "proliferate.server.cloud.cloud_sandboxes.service.sandbox_store.mark_cloud_sandbox_destroyed",
            new_callable=AsyncMock,
            return_value=sandbox,
        ) as mock_mark_destroyed,
        patch(
            "proliferate.server.cloud.cloud_sandboxes.service.get_sandbox_provider",
            return_value=provider,
        ),
    ):
        # Should NOT raise despite provider failure
        result = await destroy_cloud_sandbox(db, user)

    # Provider destroy was attempted
    provider.destroy_sandbox.assert_awaited_once()
    # DB destroy still happened
    mock_mark_destroyed.assert_awaited_once_with(db, sandbox.id)
    assert result is not None


@pytest.mark.asyncio
async def test_destroy_skips_provider_when_no_sandbox_id() -> None:
    """If there is no provider sandbox id, skip provider destroy."""
    sandbox = _make_sandbox(e2b_sandbox_id=None)
    user = type("User", (), {"id": sandbox.owner_user_id})()

    db = AsyncMock()

    with (
        patch(
            "proliferate.server.cloud.cloud_sandboxes.service.sandbox_store.load_personal_cloud_sandbox",
            new_callable=AsyncMock,
            return_value=sandbox,
        ),
        patch(
            "proliferate.server.cloud.cloud_sandboxes.service.runtime_workers_store.revoke_active_workers_for_identity",
            new_callable=AsyncMock,
        ),
        patch(
            "proliferate.server.cloud.cloud_sandboxes.service.sandbox_store.mark_cloud_sandbox_destroyed",
            new_callable=AsyncMock,
            return_value=sandbox,
        ) as mock_mark_destroyed,
        patch(
            "proliferate.server.cloud.cloud_sandboxes.service.get_sandbox_provider",
        ) as mock_get_provider,
    ):
        result = await destroy_cloud_sandbox(db, user)

    # get_sandbox_provider should not even be called when there's no id
    mock_get_provider.assert_not_called()
    # DB destroy still happened
    mock_mark_destroyed.assert_awaited_once_with(db, sandbox.id)
    assert result is not None
