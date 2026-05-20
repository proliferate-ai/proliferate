from __future__ import annotations

import pytest

from proliferate.integrations.anyharness import (
    CloudRuntimeReconnectError,
    RemoteAgentSummary,
    ResolvedRemoteWorkspace,
    RuntimeAuthProbe,
)
from proliferate.server.cloud.runtime import anyharness_api
from proliferate.server.cloud.runtime.anyharness_api import (
    _install_required_agent_kinds,
    _ready_required_agent_kinds,
)


@pytest.mark.asyncio
async def test_verify_runtime_auth_enforced_accepts_authenticated_and_rejects_unauthenticated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _check_runtime_auth_enforcement(*_args, **_kwargs) -> RuntimeAuthProbe:
        return RuntimeAuthProbe(
            authenticated_success=True,
            authenticated_status_code=200,
            authenticated_response_preview=None,
            unauthenticated_status_code=401,
            unauthenticated_response_preview='{"detail":"unauthorized"}',
        )

    monkeypatch.setattr(
        anyharness_api.anyharness,
        "check_runtime_auth_enforcement",
        _check_runtime_auth_enforcement,
    )

    await anyharness_api.verify_runtime_auth_enforced(
        "https://runtime.invalid",
        "runtime-token",
    )


@pytest.mark.asyncio
async def test_verify_runtime_auth_enforced_raises_when_bearer_token_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _check_runtime_auth_enforcement(*_args, **_kwargs) -> RuntimeAuthProbe:
        return RuntimeAuthProbe(
            authenticated_success=False,
            authenticated_status_code=401,
            authenticated_response_preview="nope",
            unauthenticated_status_code=None,
            unauthenticated_response_preview=None,
        )

    monkeypatch.setattr(
        anyharness_api.anyharness,
        "check_runtime_auth_enforcement",
        _check_runtime_auth_enforcement,
    )

    with pytest.raises(CloudRuntimeReconnectError, match="stored bearer token"):
        await anyharness_api.verify_runtime_auth_enforced(
            "https://runtime.invalid",
            "runtime-token",
        )


@pytest.mark.asyncio
async def test_verify_runtime_auth_enforced_raises_when_runtime_accepts_unauthenticated_requests(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _check_runtime_auth_enforcement(*_args, **_kwargs) -> RuntimeAuthProbe:
        return RuntimeAuthProbe(
            authenticated_success=True,
            authenticated_status_code=200,
            authenticated_response_preview=None,
            unauthenticated_status_code=200,
            unauthenticated_response_preview="[]",
        )

    monkeypatch.setattr(
        anyharness_api.anyharness,
        "check_runtime_auth_enforcement",
        _check_runtime_auth_enforcement,
    )

    with pytest.raises(CloudRuntimeReconnectError, match="did not reject"):
        await anyharness_api.verify_runtime_auth_enforced(
            "https://runtime.invalid",
            "runtime-token",
        )


@pytest.mark.asyncio
async def test_verify_runtime_auth_enforced_raises_when_probe_request_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _check_runtime_auth_enforcement(*_args, **_kwargs) -> RuntimeAuthProbe:
        raise CloudRuntimeReconnectError("boom")

    monkeypatch.setattr(
        anyharness_api.anyharness,
        "check_runtime_auth_enforcement",
        _check_runtime_auth_enforcement,
    )

    with pytest.raises(CloudRuntimeReconnectError, match="Failed to verify bearer authentication"):
        await anyharness_api.verify_runtime_auth_enforced(
            "https://runtime.invalid",
            "runtime-token",
        )


@pytest.mark.asyncio
async def test_reconcile_remote_agents_skips_install_when_required_agents_are_already_ready(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    list_calls: list[str] = []
    install_calls: list[str] = []

    async def _list_remote_agents(*_args: object, **_kwargs: object) -> list[RemoteAgentSummary]:
        list_calls.append("list")
        return [
            RemoteAgentSummary(kind="claude", readiness="ready", credential_state=None),
            RemoteAgentSummary(kind="codex", readiness="ready", credential_state=None),
        ]

    async def _install_remote_agent(*_args: object, **_kwargs: object) -> RemoteAgentSummary:
        install_calls.append("install")
        return RemoteAgentSummary(kind="claude", readiness="ready", credential_state=None)

    monkeypatch.setattr(anyharness_api, "_list_remote_agents", _list_remote_agents)
    monkeypatch.setattr(anyharness_api, "_install_remote_agent", _install_remote_agent)

    ready_agents = await anyharness_api.reconcile_remote_agents(
        "https://runtime.invalid",
        "runtime-token",
        required_agent_kinds=["claude", "codex"],
    )

    assert ready_agents == ["claude", "codex"]
    assert list_calls == ["list"]
    assert install_calls == []


@pytest.mark.asyncio
async def test_reconcile_remote_agents_installs_only_install_required_agents(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    list_responses = [
        [
            RemoteAgentSummary(kind="claude", readiness="ready", credential_state=None),
            RemoteAgentSummary(kind="codex", readiness="install_required", credential_state=None),
            RemoteAgentSummary(
                kind="gemini",
                readiness="credentials_required",
                credential_state=None,
            ),
        ],
        [
            RemoteAgentSummary(kind="claude", readiness="ready", credential_state=None),
            RemoteAgentSummary(kind="codex", readiness="ready", credential_state=None),
            RemoteAgentSummary(
                kind="gemini",
                readiness="credentials_required",
                credential_state=None,
            ),
        ],
    ]
    install_calls: list[str] = []

    async def _list_remote_agents(*_args: object, **_kwargs: object) -> list[RemoteAgentSummary]:
        return list_responses.pop(0)

    async def _install_remote_agent(
        _runtime_url: str,
        _access_token: str,
        kind: str,
        *,
        workspace_id: object | None = None,
    ) -> RemoteAgentSummary:
        del workspace_id
        install_calls.append(kind)
        return RemoteAgentSummary(kind=kind, readiness="ready", credential_state=None)

    monkeypatch.setattr(anyharness_api, "_list_remote_agents", _list_remote_agents)
    monkeypatch.setattr(anyharness_api, "_install_remote_agent", _install_remote_agent)

    ready_agents = await anyharness_api.reconcile_remote_agents(
        "https://runtime.invalid",
        "runtime-token",
        required_agent_kinds=["claude", "codex", "gemini"],
    )

    assert ready_agents == ["claude", "codex"]
    assert install_calls == ["codex"]


def test_install_required_agent_kinds_includes_gemini() -> None:
    providers = _install_required_agent_kinds(
        [
            RemoteAgentSummary(kind="claude", readiness="ready", credential_state=None),
            RemoteAgentSummary(
                kind="gemini",
                readiness="install_required",
                credential_state=None,
            ),
        ],
        ["claude", "gemini"],
    )

    assert providers == ["gemini"]


def test_ready_required_agent_kinds_includes_gemini() -> None:
    providers = _ready_required_agent_kinds(
        [
            RemoteAgentSummary(kind="claude", readiness="ready", credential_state=None),
            RemoteAgentSummary(kind="gemini", readiness="ready", credential_state=None),
            RemoteAgentSummary(kind="codex", readiness="install_required", credential_state=None),
        ],
        ["claude", "codex", "gemini"],
    )

    assert providers == ["claude", "gemini"]


@pytest.mark.asyncio
async def test_resolve_remote_workspace_accepts_current_contract_shape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _resolve_runtime_workspace(*_args, **_kwargs) -> ResolvedRemoteWorkspace:
        return ResolvedRemoteWorkspace(workspace_id="workspace-123", repo_root_id="repo-1")

    monkeypatch.setattr(
        anyharness_api.anyharness,
        "resolve_runtime_workspace",
        _resolve_runtime_workspace,
    )

    workspace = await anyharness_api.resolve_remote_workspace(
        "https://runtime.invalid",
        "runtime-token",
        runtime_workdir="/workspace",
    )

    assert workspace.workspace_id == "workspace-123"
    assert workspace.repo_root_id == "repo-1"
