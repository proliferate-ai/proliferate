"""Shared models for cloud runtime provisioning and reconnect flows."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING, Any
from uuid import UUID

from proliferate.integrations.sandbox import RuntimeEndpoint, SandboxHandle, SandboxRuntimeContext

if TYPE_CHECKING:
    from proliferate.server.cloud.runtime.credentials import ProvisionCredentials


class ProvisionStep(StrEnum):
    init = "init"
    create_sandbox = "create_sandbox"
    connect_sandbox = "connect_sandbox"
    check_preinstalled_runtime = "check_preinstalled_runtime"
    stage_runtime_binary = "stage_runtime_binary"
    check_node_runtime = "check_node_runtime"
    install_node_runtime = "install_node_runtime"
    check_rust_runtime = "check_rust_runtime"
    install_rust_runtime = "install_rust_runtime"
    sync_credentials = "sync_credentials"
    clone_repository = "clone_repository"
    checkout_cloud_branch = "checkout_cloud_branch"
    configure_git_identity = "configure_git_identity"
    start_runtime_process = "start_runtime_process"
    wait_for_runtime_health = "wait_for_runtime_health"
    reconcile_agents = "reconcile_agents"
    resolve_remote_workspace = "resolve_remote_workspace"


@dataclass(frozen=True)
class ProvisionStepMetric:
    step: ProvisionStep
    elapsed_ms: int


@dataclass(frozen=True)
class CloudProvisionInput:
    workspace_id: UUID
    user_id: UUID
    git_owner: str
    git_repo_name: str
    git_branch: str
    git_base_branch: str
    github_token: str
    git_user_name: str
    git_user_email: str
    anyharness_data_key: str
    credentials: ProvisionCredentials
    repo_env_vars: dict[str, str]
    requested_base_sha: str | None = None

    @property
    def repo_label(self) -> str:
        return f"{self.git_owner}/{self.git_repo_name}"


@dataclass(frozen=True)
class ConnectedSandbox:
    handle: SandboxHandle
    sandbox: Any
    endpoint: RuntimeEndpoint
    runtime_context: SandboxRuntimeContext


@dataclass(frozen=True)
class RuntimeHandshake:
    runtime_token: str
    ready_agents: list[str]
    anyharness_workspace_id: str


@dataclass(frozen=True)
class RuntimeConnectionTarget:
    runtime_url: str
    access_token: str
    anyharness_workspace_id: str | None
    runtime_generation: int
    ready_agent_kinds: list[str]
