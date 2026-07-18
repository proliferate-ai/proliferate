"""Credential consistency for partial Cloud sandbox runtime access."""

from __future__ import annotations

from typing import Any

import pytest

from proliferate.integrations.sandbox import RuntimeEndpoint, SandboxRuntimeContext
from proliferate.server.cloud.materialization.sandbox_io import connect
from tests.unit.test_cloud_connect_race import (
    _FakeDb,
    _FakeProvider,
    _copy_sandbox,
    _patch_connect_prelude,
    _sandbox,
)


@pytest.mark.parametrize(
    (
        "token_ciphertext",
        "data_key_ciphertext",
        "expected_runtime_token",
        "expected_data_key",
    ),
    [
        (
            "cipher:existing-token",
            None,
            "existing-token",
            "minted-data-key",
        ),
        (
            None,
            "cipher:existing-data-key",
            "minted-token",
            "existing-data-key",
        ),
    ],
    ids=["token-only", "data-key-only"],
)
@pytest.mark.asyncio
async def test_partial_runtime_credentials_persist_exact_launched_values(
    monkeypatch: pytest.MonkeyPatch,
    *,
    token_ciphertext: str | None,
    data_key_ciphertext: str | None,
    expected_runtime_token: str,
    expected_data_key: str,
) -> None:
    events: list[str] = []
    sandbox = _copy_sandbox(
        _sandbox(provider_sandbox_id="sbx-existing"),
        anyharness_bearer_token_ciphertext=token_ciphertext,
        anyharness_data_key_ciphertext=data_key_ciphertext,
    )
    provider = _FakeProvider(events)
    db = _FakeDb(events)
    _patch_connect_prelude(monkeypatch, sandbox=sandbox, provider=provider)

    def _decrypt(ciphertext: str) -> str:
        prefix = "cipher:"
        assert ciphertext.startswith(prefix)
        return ciphertext.removeprefix(prefix)

    async def _accept_resumed(*_args: Any, **_kwargs: Any) -> object:
        return sandbox

    async def _open_usage(*_args: Any, **_kwargs: Any) -> None:
        return None

    async def _resolve_runtime_endpoint(_provider_sandbox: object) -> RuntimeEndpoint:
        return RuntimeEndpoint(runtime_url="https://runtime.example.test")

    async def _resolve_runtime_context(_provider_sandbox: object) -> SandboxRuntimeContext:
        return SandboxRuntimeContext(
            home_dir="/home/user",
            runtime_workdir="/home/user",
            runtime_binary_path="/usr/local/bin/anyharness",
            base_env={},
        )

    launched: dict[str, str] = {}

    async def _launch_runtime(
        *_args: Any,
        runtime_token: str,
        anyharness_data_key: str,
        **_kwargs: Any,
    ) -> None:
        launched.update(
            runtime_token=runtime_token,
            anyharness_data_key=anyharness_data_key,
        )

    persisted: dict[str, str] = {}

    async def _mark_ready(
        *_args: Any,
        anyharness_bearer_token_ciphertext: str,
        anyharness_data_key_ciphertext: str,
        **_kwargs: Any,
    ) -> object:
        persisted.update(
            runtime_token_ciphertext=anyharness_bearer_token_ciphertext,
            data_key_ciphertext=anyharness_data_key_ciphertext,
        )
        return sandbox

    monkeypatch.setattr(connect, "decrypt_text", _decrypt)
    monkeypatch.setattr(connect, "encrypt_text", lambda value: f"cipher:{value}")
    monkeypatch.setattr(connect.secrets, "token_urlsafe", lambda _length: "minted-token")
    monkeypatch.setattr(connect, "generate_anyharness_data_key", lambda: "minted-data-key")
    monkeypatch.setattr(connect, "accept_resumed_provider", _accept_resumed)
    monkeypatch.setattr(connect, "open_cloud_sandbox_provider_usage", _open_usage)
    monkeypatch.setattr(
        provider,
        "resolve_runtime_endpoint",
        _resolve_runtime_endpoint,
        raising=False,
    )
    monkeypatch.setattr(
        provider,
        "resolve_runtime_context",
        _resolve_runtime_context,
        raising=False,
    )
    monkeypatch.setattr(connect, "_launch_anyharness_runtime", _launch_runtime)
    monkeypatch.setattr(connect.cloud_sandboxes_store, "mark_cloud_sandbox_ready", _mark_ready)

    await connect.connect_ready_sandbox(db, sandbox=sandbox)

    assert launched == {
        "runtime_token": expected_runtime_token,
        "anyharness_data_key": expected_data_key,
    }
    assert _decrypt(persisted["runtime_token_ciphertext"]) == launched["runtime_token"]
    assert _decrypt(persisted["data_key_ciphertext"]) == launched["anyharness_data_key"]
