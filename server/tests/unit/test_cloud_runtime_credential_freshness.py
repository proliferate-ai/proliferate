from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from proliferate.db.models.cloud import CloudCredential, CloudRuntimeEnvironment
from proliferate.integrations.sandbox import SandboxRuntimeContext
from proliferate.server.cloud.runtime import credential_freshness
from proliferate.server.cloud.runtime.credential_freshness import (
    build_credential_freshness_snapshot,
    build_credential_revision_state,
    ensure_runtime_environment_credentials_current,
)
from proliferate.utils.crypto import encrypt_json, encrypt_text


def _credential(
    user_id: UUID,
    *,
    provider: str,
    auth_mode: str,
    payload: dict[str, object],
) -> CloudCredential:
    return CloudCredential(
        id=uuid4(),
        user_id=user_id,
        provider=provider,
        auth_mode=auth_mode,
        payload_ciphertext=encrypt_json(payload),
        payload_format="json-v1",
    )


def _environment(user_id: UUID) -> CloudRuntimeEnvironment:
    return CloudRuntimeEnvironment(
        id=uuid4(),
        user_id=user_id,
        organization_id=None,
        created_by_user_id=user_id,
        billing_subject_id=user_id,
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        git_owner_norm="acme",
        git_repo_name_norm="rocket",
        isolation_policy="repo_shared",
        status="running",
        runtime_generation=1,
        credential_snapshot_version=0,
        repo_env_applied_version=0,
    )


def test_credential_revisions_split_file_and_process_credentials() -> None:
    user_id = uuid4()
    file_record = _credential(
        user_id,
        provider="codex",
        auth_mode="file",
        payload={
            "provider": "codex",
            "authMode": "file",
            "files": {".codex/auth.json": '{"access_token":"opaque"}'},
        },
    )
    env_record = _credential(
        user_id,
        provider="claude",
        auth_mode="env",
        payload={
            "provider": "claude",
            "authMode": "env",
            "envVars": {"ANTHROPIC_API_KEY": "key"},
        },
    )

    revisions = build_credential_revision_state([file_record, env_record])

    assert str(file_record.id) in revisions.files_revision
    assert str(env_record.id) not in revisions.files_revision
    assert str(env_record.id) in revisions.process_revision
    assert str(file_record.id) not in revisions.process_revision
    assert revisions.credentials.synced_providers == ("claude", "codex")


def test_credential_snapshot_reports_restart_required_for_stale_process() -> None:
    user_id = uuid4()
    env_record = _credential(
        user_id,
        provider="claude",
        auth_mode="env",
        payload={
            "provider": "claude",
            "authMode": "env",
            "envVars": {"ANTHROPIC_API_KEY": "key"},
        },
    )
    revisions = build_credential_revision_state([env_record])
    environment = _environment(user_id)
    environment.credential_files_applied_revision = revisions.files_revision

    snapshot = build_credential_freshness_snapshot(environment, revisions)

    assert snapshot.status == "restart_required"
    assert snapshot.files_current is True
    assert snapshot.process_current is False
    assert snapshot.requires_restart is True


def test_credential_snapshot_reports_current_when_revisions_match() -> None:
    user_id = uuid4()
    file_record = _credential(
        user_id,
        provider="codex",
        auth_mode="file",
        payload={
            "provider": "codex",
            "authMode": "file",
            "files": {".codex/auth.json": '{"access_token":"opaque"}'},
        },
    )
    revisions = build_credential_revision_state([file_record])
    environment = _environment(user_id)
    environment.credential_files_applied_revision = revisions.files_revision
    environment.credential_process_applied_revision = revisions.process_revision

    snapshot = build_credential_freshness_snapshot(environment, revisions)

    assert snapshot.status == "current"
    assert snapshot.files_current is True
    assert snapshot.process_current is True


def test_credential_snapshot_reports_missing_only_after_empty_revisions_applied() -> None:
    user_id = uuid4()
    revisions = build_credential_revision_state([])
    environment = _environment(user_id)
    environment.credential_files_applied_revision = "credential-files:v1:old"
    environment.credential_process_applied_revision = revisions.process_revision

    snapshot = build_credential_freshness_snapshot(environment, revisions)

    assert snapshot.status == "stale"
    assert snapshot.files_current is False
    assert snapshot.process_current is True

    environment.credential_files_applied_revision = revisions.files_revision
    snapshot = build_credential_freshness_snapshot(environment, revisions)

    assert snapshot.status == "missing_credentials"
    assert snapshot.files_current is True
    assert snapshot.process_current is True


def test_credential_snapshot_reports_apply_failed_before_missing_credentials() -> None:
    user_id = uuid4()
    revisions = build_credential_revision_state([])
    environment = _environment(user_id)
    environment.credential_files_applied_revision = "credential-files:v1:old"
    environment.credential_process_applied_revision = "credential-process:v1:old"
    environment.credential_last_error = "sanitized"

    snapshot = build_credential_freshness_snapshot(environment, revisions)

    assert snapshot.status == "apply_failed"
    assert snapshot.last_error == "sanitized"


def test_credential_snapshot_treats_legacy_running_null_revisions_as_current() -> None:
    user_id = uuid4()
    env_record = _credential(
        user_id,
        provider="claude",
        auth_mode="env",
        payload={
            "provider": "claude",
            "authMode": "env",
            "envVars": {"ANTHROPIC_API_KEY": "key"},
        },
    )
    revisions = build_credential_revision_state([env_record])
    environment = _environment(user_id)
    environment.active_sandbox_id = uuid4()

    snapshot = build_credential_freshness_snapshot(environment, revisions)

    assert snapshot.status == "current"
    assert snapshot.files_current is True
    assert snapshot.process_current is True


def test_runtime_stop_pattern_does_not_match_wrapper_command_literal() -> None:
    pattern = credential_freshness._pgrep_pattern_for_runtime_binary("/home/user/anyharness")

    assert pattern == "[/]home/user/anyharness"
    assert "/home/user/anyharness" not in pattern


@pytest.mark.asyncio
async def test_file_only_apply_reconciles_remote_agents(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id = uuid4()
    file_record = _credential(
        user_id,
        provider="codex",
        auth_mode="file",
        payload={
            "provider": "codex",
            "authMode": "file",
            "files": {".codex/auth.json": '{"access_token":"opaque"}'},
        },
    )
    revisions = build_credential_revision_state([file_record])
    environment = _environment(user_id)
    environment.runtime_url = "https://runtime.invalid"
    environment.runtime_token_ciphertext = encrypt_text("runtime-token")
    environment.credential_files_applied_revision = "credential-files:v1:old"
    environment.credential_process_applied_revision = revisions.process_revision

    writes: list[object] = []
    reconciles: list[tuple[str, str, tuple[str, ...]]] = []

    @asynccontextmanager
    async def _lock(_runtime_environment_id):
        yield

    async def _load_environment(_runtime_environment_id):
        return environment

    async def _load_credentials(_user_id):
        return [file_record]

    async def _connect_runtime_sandbox(_environment):
        return (
            SimpleNamespace(),
            object(),
            SandboxRuntimeContext(
                home_dir="/home/user",
                runtime_workdir="/home/user/workspace",
                runtime_binary_path="/home/user/anyharness",
                base_env={},
            ),
        )

    async def _write_credential_files(*_args, **_kwargs):
        writes.append(_kwargs["credentials"])

    async def _save_runtime_environment_state(_environment_id, **kwargs):
        for key, value in kwargs.items():
            setattr(environment, key, value)
        return environment

    async def _reconcile_remote_agents(runtime_url, access_token, **kwargs):
        reconciles.append((runtime_url, access_token, tuple(kwargs["synced_providers"])))
        return list(kwargs["synced_providers"])

    monkeypatch.setattr(
        credential_freshness,
        "runtime_environment_credential_apply_lock",
        _lock,
    )
    monkeypatch.setattr(
        credential_freshness,
        "load_runtime_environment_by_id",
        _load_environment,
    )
    monkeypatch.setattr(
        credential_freshness,
        "load_cloud_credentials_for_user",
        _load_credentials,
    )
    monkeypatch.setattr(
        credential_freshness,
        "_connect_runtime_sandbox",
        _connect_runtime_sandbox,
    )
    monkeypatch.setattr(
        credential_freshness,
        "write_credential_files",
        _write_credential_files,
    )
    monkeypatch.setattr(
        credential_freshness,
        "save_runtime_environment_state",
        _save_runtime_environment_state,
    )
    monkeypatch.setattr(
        credential_freshness,
        "reconcile_remote_agents",
        _reconcile_remote_agents,
    )

    snapshot = await ensure_runtime_environment_credentials_current(
        environment.id,
        workspace_id=uuid4(),
        allow_process_restart=True,
    )

    assert snapshot.status == "current"
    assert writes == [revisions.credentials]
    assert reconciles == [
        ("https://runtime.invalid", "runtime-token", ("codex",)),
    ]
