"""Tests for killed-sandbox recovery in connect_ready_sandbox."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.integrations.sandbox.base import (
    SandboxHandle,
    SandboxNotFoundError,
    SandboxProviderKind,
)
from proliferate.server.cloud.materialization.sandbox_io.connect import (
    connect_ready_sandbox,
)


def _make_sandbox(
    *,
    e2b_sandbox_id: str | None = "stale-sandbox-123",
    anyharness_base_url: str | None = "https://old.host",
    anyharness_bearer_token_ciphertext: str | None = "enc-token",
    anyharness_data_key_ciphertext: str | None = "enc-key",
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
        anyharness_base_url=anyharness_base_url,
        anyharness_bearer_token_ciphertext=anyharness_bearer_token_ciphertext,
        anyharness_data_key_ciphertext=anyharness_data_key_ciphertext,
        runtime_generation=0,
        created_at=now,
        updated_at=now,
        ready_at=now,
        last_health_at=now,
        destroyed_at=None,
    )


@pytest.mark.asyncio
async def test_connect_recovers_from_sandbox_not_found() -> None:
    """When resume_sandbox raises SandboxNotFoundError, connect should recreate."""
    sandbox = _make_sandbox()
    new_sandbox_id = "new-sandbox-456"

    # Provider mock
    provider = AsyncMock()
    resume_call_count = 0

    async def resume_side_effect(sandbox_id: str, **kwargs: Any) -> object:
        nonlocal resume_call_count
        resume_call_count += 1
        if resume_call_count == 1:
            # First call: sandbox is gone
            raise SandboxNotFoundError(sandbox_id)
        # Second call: new sandbox is fine
        return SimpleNamespace(sandbox_id=new_sandbox_id)

    provider.resume_sandbox = AsyncMock(side_effect=resume_side_effect)
    provider.create_sandbox = AsyncMock(
        return_value=SandboxHandle(
            provider=SandboxProviderKind.e2b,
            sandbox_id=new_sandbox_id,
            template_version="v1",
        )
    )
    provider.template_version = "v1"
    provider.resolve_runtime_endpoint = AsyncMock(
        return_value=SimpleNamespace(runtime_url="https://new.host")
    )
    provider.resolve_runtime_context = AsyncMock(
        return_value=SimpleNamespace(
            home_dir="/home/user",
            runtime_workdir="/home/user/work",
            runtime_binary_path="/usr/bin/anyharness",
            base_env={"HOME": "/home/user"},
        )
    )
    provider.write_file = AsyncMock()
    provider.run_command = AsyncMock(return_value=SimpleNamespace(exit_code=0))

    # DB mock
    db = AsyncMock()
    db.commit = AsyncMock()

    record_provider_sandbox_calls: list[str] = []

    async def mock_record_provider_sandbox(
        _db: Any, _id: Any, *, e2b_sandbox_id: str, e2b_template_ref: str
    ) -> CloudSandboxValue | None:
        record_provider_sandbox_calls.append(e2b_sandbox_id)
        return None

    with (
        patch(
            "proliferate.server.cloud.materialization.sandbox_io.connect.get_sandbox_provider",
            return_value=provider,
        ),
        patch(
            "proliferate.server.cloud.materialization.sandbox_io.connect.cloud_sandboxes_store.record_cloud_sandbox_provider_sandbox",
            side_effect=mock_record_provider_sandbox,
        ),
        patch(
            "proliferate.server.cloud.materialization.sandbox_io.connect.cloud_sandboxes_store.mark_cloud_sandbox_ready",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch(
            "proliferate.server.cloud.materialization.sandbox_io.connect.wait_for_runtime_health",
            new_callable=AsyncMock,
        ),
        patch(
            "proliferate.server.cloud.materialization.sandbox_io.connect.verify_runtime_auth_enforced",
            new_callable=AsyncMock,
        ),
        patch(
            "proliferate.server.cloud.materialization.sandbox_io.connect.launch_worker_sidecar",
            new_callable=AsyncMock,
        ),
        patch(
            "proliferate.server.cloud.materialization.sandbox_io.connect.decrypt_text",
            side_effect=lambda x: f"decrypted-{x}",
        ),
        patch(
            "proliferate.server.cloud.materialization.sandbox_io.connect.encrypt_text",
            side_effect=lambda x: f"encrypted-{x}",
        ),
        patch(
            "proliferate.server.cloud.materialization.sandbox_io.connect.generate_anyharness_data_key",
            return_value="new-data-key",
        ),
        patch(
            "proliferate.server.cloud.materialization.sandbox_io.connect.build_runtime_env",
            return_value={},
        ),
        patch(
            "proliferate.server.cloud.materialization.sandbox_io.connect.build_runtime_launch_script",
            return_value=b"#!/bin/bash\necho hello",
        ),
        patch(
            "proliferate.server.cloud.materialization.sandbox_io.connect.runtime_launcher_path",
            return_value="/tmp/launcher.sh",
        ),
        patch(
            "proliferate.server.cloud.materialization.sandbox_io.connect.build_detached_runtime_launch_command",
            return_value="nohup /tmp/launcher.sh &",
        ),
        patch(
            "proliferate.server.cloud.materialization.sandbox_io.connect.run_sandbox_command_logged",
            new_callable=AsyncMock,
            return_value=SimpleNamespace(exit_code=0),
        ),
        patch(
            "proliferate.server.cloud.materialization.sandbox_io.connect.assert_command_succeeded",
        ),
    ):
        target = await connect_ready_sandbox(db, sandbox=sandbox)

    # Verify create_sandbox was called (recreating after not-found)
    provider.create_sandbox.assert_called_once()
    # Verify resume was called twice (first raises, second succeeds)
    assert resume_call_count == 2
    # Verify the new sandbox id was recorded
    assert new_sandbox_id in record_provider_sandbox_calls


@pytest.mark.asyncio
async def test_connect_does_not_swallow_transient_errors() -> None:
    """Transient errors from resume_sandbox must propagate, not trigger recreate."""
    sandbox = _make_sandbox()

    provider = AsyncMock()
    provider.resume_sandbox = AsyncMock(
        side_effect=RuntimeError("network timeout — transient")
    )

    db = AsyncMock()

    with (
        patch(
            "proliferate.server.cloud.materialization.sandbox_io.connect.get_sandbox_provider",
            return_value=provider,
        ),
        patch(
            "proliferate.server.cloud.materialization.sandbox_io.connect.decrypt_text",
            side_effect=lambda x: f"decrypted-{x}",
        ),
    ):
        with pytest.raises(RuntimeError, match="network timeout"):
            await connect_ready_sandbox(db, sandbox=sandbox)

    # create_sandbox must NOT have been called — only not-found triggers recreation
    provider.create_sandbox.assert_not_called()
