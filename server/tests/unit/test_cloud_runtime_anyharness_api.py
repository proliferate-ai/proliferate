from __future__ import annotations

import pytest

from proliferate.integrations.anyharness import (
    CloudRuntimeReconnectError,
    RemoteAgentSummary,
    ResolvedRemoteWorkspace,
    RuntimeAuthProbe,
)
from proliferate.server.cloud.runtime.credentials import remote_agents
from proliferate.server.cloud.runtime.credentials.remote_agents import (
    _auth_overlay_ready_agent_kinds,
    _install_required_agent_kinds,
    _ready_required_agent_kinds,
)
from proliferate.server.cloud.runtime.liveness import health as runtime_health
from proliferate.server.cloud.runtime.provisioning import remote_workspace


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
        runtime_health.anyharness,
        "check_runtime_auth_enforcement",
        _check_runtime_auth_enforcement,
    )

    await runtime_health.verify_runtime_auth_enforced(
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
        runtime_health.anyharness,
        "check_runtime_auth_enforcement",
        _check_runtime_auth_enforcement,
    )

    with pytest.raises(CloudRuntimeReconnectError, match="stored bearer token"):
        await runtime_health.verify_runtime_auth_enforced(
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
        runtime_health.anyharness,
        "check_runtime_auth_enforcement",
        _check_runtime_auth_enforcement,
    )

    with pytest.raises(CloudRuntimeReconnectError, match="did not reject"):
        await runtime_health.verify_runtime_auth_enforced(
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
        runtime_health.anyharness,
        "check_runtime_auth_enforcement",
        _check_runtime_auth_enforcement,
    )

    with pytest.raises(CloudRuntimeReconnectError, match="Failed to verify bearer authentication"):
        await runtime_health.verify_runtime_auth_enforced(
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

    monkeypatch.setattr(remote_agents, "_list_remote_agents", _list_remote_agents)
    monkeypatch.setattr(remote_agents, "_install_remote_agent", _install_remote_agent)

    ready_agents = await remote_agents.reconcile_remote_agents(
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

    monkeypatch.setattr(remote_agents, "_list_remote_agents", _list_remote_agents)
    monkeypatch.setattr(remote_agents, "_install_remote_agent", _install_remote_agent)

    ready_agents = await remote_agents.reconcile_remote_agents(
        "https://runtime.invalid",
        "runtime-token",
        required_agent_kinds=["claude", "codex", "gemini"],
    )

    assert ready_agents == ["claude", "codex"]
    assert install_calls == ["codex"]


@pytest.mark.asyncio
async def test_reconcile_remote_agents_accepts_auth_overlay_credential_gated_agents(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _list_remote_agents(*_args: object, **_kwargs: object) -> list[RemoteAgentSummary]:
        return [
            RemoteAgentSummary(
                kind="claude",
                readiness="login_required",
                credential_state="login_required",
            ),
            RemoteAgentSummary(
                kind="codex",
                readiness="credentials_required",
                credential_state="missing_env",
            ),
        ]

    async def _install_remote_agent(*_args: object, **_kwargs: object) -> RemoteAgentSummary:
        raise AssertionError("credential-gated agents should not be installed")

    monkeypatch.setattr(remote_agents, "_list_remote_agents", _list_remote_agents)
    monkeypatch.setattr(remote_agents, "_install_remote_agent", _install_remote_agent)

    ready_agents = await remote_agents.reconcile_remote_agents(
        "https://runtime.invalid",
        "runtime-token",
        required_agent_kinds=["claude", "codex"],
        auth_overlay_agent_kinds=["claude", "codex"],
    )

    assert ready_agents == ["claude", "codex"]


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


def test_auth_overlay_ready_agent_kinds_only_accepts_credential_gated_agents() -> None:
    providers = _auth_overlay_ready_agent_kinds(
        [
            RemoteAgentSummary(
                kind="claude",
                readiness="login_required",
                credential_state="login_required",
            ),
            RemoteAgentSummary(
                kind="codex",
                readiness="credentials_required",
                credential_state="missing_env",
            ),
            RemoteAgentSummary(
                kind="gemini",
                readiness="install_required",
                credential_state=None,
            ),
            RemoteAgentSummary(kind="opencode", readiness="error", credential_state=None),
        ],
        ["claude", "codex", "gemini", "opencode"],
    )

    assert providers == ["claude", "codex"]


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
        remote_workspace.anyharness,
        "resolve_runtime_workspace",
        _resolve_runtime_workspace,
    )

    workspace = await remote_workspace.resolve_remote_workspace(
        "https://runtime.invalid",
        "runtime-token",
        runtime_workdir="/workspace",
    )

    assert workspace.workspace_id == "workspace-123"
    assert workspace.repo_root_id == "repo-1"
