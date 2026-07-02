"""Shared hardcoded constants for the cloud workspace domain.

These values are referenced by multiple cloud subpackages (credentials,
repos, runtime, workspaces) and are therefore centralized here instead of
being scattered across individual feature modules.

File-private constants that are only consumed within a single module
should remain in that module.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Final, Literal

# ---------------------------------------------------------------------------
# Supported cloud agent kinds
# ---------------------------------------------------------------------------

CloudAgentKind = Literal["claude", "codex", "opencode", "gemini", "grok"]
AgentCredentialProviderId = Literal["anthropic", "openai", "gemini", "cursor", "xai"]

SUPPORTED_CLOUD_AGENTS: tuple[CloudAgentKind, ...] = (
    "claude",
    "codex",
    "opencode",
    "gemini",
    "grok",
)

SUPPORTED_AGENT_CREDENTIAL_PROVIDERS: tuple[AgentCredentialProviderId, ...] = (
    "anthropic",
    "openai",
    "gemini",
    "cursor",
    "xai",
)

# Native credential sync does not support every catalog agent kind yet.
SUPPORTED_CLOUD_CREDENTIAL_SYNC_AGENTS: tuple[CloudAgentKind, ...] = (
    "claude",
    "codex",
    "gemini",
)

ANYHARNESS_RESERVED_ENV_PREFIX: str = "ANYHARNESS_"
PROLIFERATE_RESERVED_ENV_PREFIX: str = "PROLIFERATE_"

# Mirror the agent credential env vars AnyHarness currently recognizes so repo
# env-var sync cannot override runtime-managed auth inputs.
RESERVED_CLOUD_REPO_ENV_VARS: frozenset[str] = frozenset(
    {
        "AMP_API_KEY",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_CUSTOM_HEADERS",
        "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
        "CODEX_API_KEY",
        "CODEX_HOME",
        "CURSOR_API_KEY",
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "GOOGLE_GEMINI_BASE_URL",
        "GOOGLE_GENAI_USE_VERTEXAI",
        "GROK_API_KEY",
        "OPENAI_API_KEY",
        "OPENAI_BASE_URL",
        "XAI_API_KEY",
    }
)

CLOUD_REPO_CONFIG_FILE_MAX_BYTES: Final = 1_048_576

# ---------------------------------------------------------------------------
# Agent LLM auth gateway
# ---------------------------------------------------------------------------


class SandboxProfileOwnerScope(StrEnum):
    personal = "personal"
    organization = "organization"


class SandboxProfileStatus(StrEnum):
    configuring = "configuring"
    provisioning = "provisioning"
    active = "active"
    disabled = "disabled"
    blocked = "blocked"
    error = "error"


class AgentAuthOwnerScope(StrEnum):
    system = "system"
    personal = "personal"
    organization = "organization"


class AgentAuthCredentialKind(StrEnum):
    managed_gateway = "managed_gateway"
    synced_path = "synced_path"


class AgentAuthCredentialStatus(StrEnum):
    pending = "pending"
    ready = "ready"
    needs_resync = "needs_resync"
    invalid = "invalid"
    revoked = "revoked"


class AgentAuthCredentialShareStatus(StrEnum):
    active = "active"
    revoked = "revoked"


class AgentGatewayPolicyKind(StrEnum):
    proliferate_managed = "proliferate_managed"
    org_byok = "org_byok"
    personal_byok = "personal_byok"


class AgentGatewayBudgetKind(StrEnum):
    proliferate_managed = "proliferate_managed"


class AgentGatewaySyncStatus(StrEnum):
    pending = "pending"
    synced = "synced"
    drifted = "drifted"
    failed = "failed"


class AgentGatewayPolicyStatus(StrEnum):
    provisioning = "provisioning"
    ready = "ready"
    invalid = "invalid"
    revoked = "revoked"


class AgentGatewayBudgetSubjectStatus(StrEnum):
    ready = "ready"
    exhausted = "exhausted"
    invalid = "invalid"
    revoked = "revoked"


class AgentGatewayFreeCreditEntitlementStatus(StrEnum):
    provisioning = "provisioning"
    active = "active"
    exhausted = "exhausted"
    expired = "expired"
    revoked = "revoked"


class AgentGatewayProviderKind(StrEnum):
    proliferate_bedrock_pool = "proliferate_bedrock_pool"
    anthropic_api_key = "anthropic_api_key"
    openai_api_key = "openai_api_key"
    gemini_api_key = "gemini_api_key"
    bedrock_assume_role = "bedrock_assume_role"
    openai_compatible = "openai_compatible"


class AgentGatewayProviderValidationStatus(StrEnum):
    unvalidated = "unvalidated"
    valid = "valid"
    invalid = "invalid"


class SandboxAgentAuthMaterializationMode(StrEnum):
    gateway_env = "gateway_env"
    synced_files = "synced_files"


class SandboxAgentAuthSelectionStatus(StrEnum):
    active = "active"
    needs_resync = "needs_resync"
    invalid = "invalid"


class SandboxAgentAuthTargetStateStatus(StrEnum):
    pending = "pending"
    materializing = "materializing"
    applied = "applied"
    failed = "failed"
    superseded = "superseded"


class AgentGatewayProtocolFacade(StrEnum):
    anthropic = "anthropic"
    openai = "openai"
    genai = "genai"


class AgentGatewayRouterKind(StrEnum):
    bifrost = "bifrost"


class AgentGatewayRouterObjectKind(StrEnum):
    provider_key = "provider_key"
    virtual_key = "virtual_key"


class AgentGatewayRouterObjectScope(StrEnum):
    budget_subject = "budget_subject"
    policy = "policy"
    runtime_selection = "runtime_selection"


class AgentGatewayRouterMaterializationStatus(StrEnum):
    active = "active"
    disabled = "disabled"
    failed = "failed"
    revoked = "revoked"


SUPPORTED_SANDBOX_PROFILE_OWNER_SCOPES: tuple[str, ...] = tuple(
    scope.value for scope in SandboxProfileOwnerScope
)
SUPPORTED_SANDBOX_PROFILE_STATUSES: tuple[str, ...] = tuple(
    status.value for status in SandboxProfileStatus
)
SUPPORTED_AGENT_AUTH_OWNER_SCOPES: tuple[str, ...] = tuple(
    scope.value for scope in AgentAuthOwnerScope
)
SUPPORTED_AGENT_AUTH_CREDENTIAL_KINDS: tuple[str, ...] = tuple(
    kind.value for kind in AgentAuthCredentialKind
)
SUPPORTED_AGENT_AUTH_CREDENTIAL_STATUSES: tuple[str, ...] = tuple(
    status.value for status in AgentAuthCredentialStatus
)
SUPPORTED_AGENT_AUTH_CREDENTIAL_SHARE_STATUSES: tuple[str, ...] = tuple(
    status.value for status in AgentAuthCredentialShareStatus
)
SUPPORTED_AGENT_GATEWAY_POLICY_KINDS: tuple[str, ...] = tuple(
    kind.value for kind in AgentGatewayPolicyKind
)
SUPPORTED_AGENT_GATEWAY_BUDGET_KINDS: tuple[str, ...] = tuple(
    kind.value for kind in AgentGatewayBudgetKind
)
SUPPORTED_AGENT_GATEWAY_SYNC_STATUSES: tuple[str, ...] = tuple(
    status.value for status in AgentGatewaySyncStatus
)
SUPPORTED_AGENT_GATEWAY_POLICY_STATUSES: tuple[str, ...] = tuple(
    status.value for status in AgentGatewayPolicyStatus
)
SUPPORTED_AGENT_GATEWAY_BUDGET_SUBJECT_STATUSES: tuple[str, ...] = tuple(
    status.value for status in AgentGatewayBudgetSubjectStatus
)
SUPPORTED_AGENT_GATEWAY_FREE_CREDIT_ENTITLEMENT_STATUSES: tuple[str, ...] = tuple(
    status.value for status in AgentGatewayFreeCreditEntitlementStatus
)
SUPPORTED_AGENT_GATEWAY_PROVIDER_KINDS: tuple[str, ...] = tuple(
    kind.value for kind in AgentGatewayProviderKind
)
SUPPORTED_AGENT_GATEWAY_PROVIDER_VALIDATION_STATUSES: tuple[str, ...] = tuple(
    status.value for status in AgentGatewayProviderValidationStatus
)
SUPPORTED_SANDBOX_AGENT_AUTH_MATERIALIZATION_MODES: tuple[str, ...] = tuple(
    mode.value for mode in SandboxAgentAuthMaterializationMode
)
SUPPORTED_SANDBOX_AGENT_AUTH_SELECTION_STATUSES: tuple[str, ...] = tuple(
    status.value for status in SandboxAgentAuthSelectionStatus
)
SUPPORTED_SANDBOX_AGENT_AUTH_TARGET_STATE_STATUSES: tuple[str, ...] = tuple(
    status.value for status in SandboxAgentAuthTargetStateStatus
)
SUPPORTED_SANDBOX_PROFILE_TARGET_STATE_STATUSES: tuple[str, ...] = (
    SUPPORTED_SANDBOX_AGENT_AUTH_TARGET_STATE_STATUSES
)
SUPPORTED_AGENT_GATEWAY_PROTOCOL_FACADES: tuple[str, ...] = tuple(
    facade.value for facade in AgentGatewayProtocolFacade
)
SUPPORTED_AGENT_GATEWAY_ROUTER_KINDS: tuple[str, ...] = tuple(
    kind.value for kind in AgentGatewayRouterKind
)
SUPPORTED_AGENT_GATEWAY_ROUTER_OBJECT_KINDS: tuple[str, ...] = tuple(
    kind.value for kind in AgentGatewayRouterObjectKind
)
SUPPORTED_AGENT_GATEWAY_ROUTER_OBJECT_SCOPES: tuple[str, ...] = tuple(
    scope.value for scope in AgentGatewayRouterObjectScope
)
SUPPORTED_AGENT_GATEWAY_ROUTER_MATERIALIZATION_STATUSES: tuple[str, ...] = tuple(
    status.value for status in AgentGatewayRouterMaterializationStatus
)

AGENT_GATEWAY_CIPHERTEXT_KEY_ID: Final = "cloud_secret_key:v1"
AGENT_GATEWAY_BUDGET_DURATION_V1: Final = "30d"

# ---------------------------------------------------------------------------
# Allowed credential auth files
# ---------------------------------------------------------------------------

CLAUDE_ALLOWED_AUTH_FILES: frozenset[str] = frozenset(
    {
        ".claude/.credentials.json",
        ".claude.json",
    }
)

CODEX_ALLOWED_AUTH_FILES: frozenset[str] = frozenset(
    {
        ".codex/auth.json",
    }
)

GEMINI_ALLOWED_AUTH_FILES: frozenset[str] = frozenset(
    {
        ".gemini/oauth_creds.json",
        ".gemini/settings.json",
    }
)

# ---------------------------------------------------------------------------
# Cloud runtime/workspace lifecycle status
# ---------------------------------------------------------------------------


class RepoEnvironmentKind(StrEnum):
    local = "local"
    cloud = "cloud"


class GitProvider(StrEnum):
    github = "github"


class CloudSecretScopeKind(StrEnum):
    personal = "personal"
    organization = "organization"
    workspace = "workspace"


class CloudSandboxSecretMaterializationKind(StrEnum):
    global_ = "global"
    workspace = "workspace"


class CloudSandboxSecretMaterializationStatus(StrEnum):
    pending = "pending"
    running = "running"
    ready = "ready"
    error = "error"


class CloudMaterializationStatus(StrEnum):
    pending = "pending"
    running = "running"
    ready = "ready"
    error = "error"


class CloudSandboxType(StrEnum):
    e2b = "e2b"


class CloudSandboxStatus(StrEnum):
    creating = "creating"
    ready = "ready"
    paused = "paused"
    error = "error"
    destroyed = "destroyed"


class CloudRuntimeEnvironmentStatus(StrEnum):
    pending = "pending"
    provisioning = "provisioning"
    running = "running"
    paused = "paused"
    error = "error"
    disabled = "disabled"


class CloudWorkspaceStatus(StrEnum):
    pending = "pending"
    materializing = "materializing"
    needs_rematerialization = "needs_rematerialization"
    ready = "ready"
    archived = "archived"
    error = "error"


class CloudWorkspaceCleanupState(StrEnum):
    none = "none"
    pending = "pending"
    blocked = "blocked"
    complete = "complete"
    failed = "failed"


class CloudRuntimeIsolationPolicy(StrEnum):
    repo_shared = "repo_shared"


class WorkspaceStatus(StrEnum):
    """Deprecated compatibility alias for older call sites.

    New cloud workspace code should use ``CloudWorkspaceStatus`` for visible
    worktree materialization state and ``CloudRuntimeEnvironmentStatus`` for
    runtime availability. The compatibility values keep transitional code
    import-safe while the service layer is migrated.
    """

    queued = CloudWorkspaceStatus.pending.value
    provisioning = CloudWorkspaceStatus.materializing.value
    syncing_credentials = CloudWorkspaceStatus.materializing.value
    cloning_repo = CloudWorkspaceStatus.materializing.value
    starting_runtime = CloudWorkspaceStatus.materializing.value
    ready = CloudWorkspaceStatus.ready.value
    stopped = CloudWorkspaceStatus.archived.value
    error = CloudWorkspaceStatus.error.value


class WorkspacePostReadyPhase(StrEnum):
    idle = "idle"
    applying_files = "applying_files"
    starting_setup = "starting_setup"
    completed = "completed"
    failed = "failed"


SETUP_RUN_STATUS_PENDING: Final = "pending"
SETUP_RUN_STATUS_RUNNING: Final = "running"
SETUP_RUN_STATUS_SUCCEEDED: Final = "succeeded"
SETUP_RUN_STATUS_FAILED: Final = "failed"
SETUP_RUN_STATUS_TIMED_OUT: Final = "timed_out"
SETUP_RUN_STATUS_STALE: Final = "stale"
SETUP_RUN_ACTIVE_STATUSES: Final = frozenset(
    {
        SETUP_RUN_STATUS_PENDING,
        SETUP_RUN_STATUS_RUNNING,
    }
)
MAX_SETUP_MONITOR_ERROR_CHARS: Final = 2000
SETUP_RUN_MISSING_WORKSPACE_ERROR: Final = "Cloud workspace no longer exists."
SETUP_RUN_SUPERSEDED_ERROR: Final = "Setup run was superseded by a newer apply."
SETUP_RUN_DEFAULT_FAILURE_ERROR: Final = "Repo setup failed"


WORKSPACE_REPO_APPLY_LOCK_SALT: int = 4_203_902


# ---------------------------------------------------------------------------
# Cloud worktree retention policy
# ---------------------------------------------------------------------------

DEFAULT_MAX_MATERIALIZED_WORKTREES_PER_REPO = 20
MIN_MAX_MATERIALIZED_WORKTREES_PER_REPO = 10
MAX_MAX_MATERIALIZED_WORKTREES_PER_REPO = 100
DEFAULT_WORKTREE_POLICY_UPDATED_AT = "1970-01-01T00:00:00+00:00"


# ---------------------------------------------------------------------------
# Git provider
# ---------------------------------------------------------------------------

SUPPORTED_GIT_PROVIDER: str = "github"


# ---------------------------------------------------------------------------
# Cloud compute targets and Proliferate Worker lifecycle
# ---------------------------------------------------------------------------


class CloudTargetKind(StrEnum):
    managed_cloud = "managed_cloud"
    ssh = "ssh"
    desktop_dispatch = "desktop_dispatch"
    local_direct = "local_direct"
    self_hosted_cloud = "self_hosted_cloud"


class CloudTargetProfileRole(StrEnum):
    primary = "primary"
    none = "none"


class CloudTargetStatus(StrEnum):
    enrolling = "enrolling"
    online = "online"
    offline = "offline"
    degraded = "degraded"
    archived = "archived"


class CloudWorkerStatus(StrEnum):
    enrolling = "enrolling"
    online = "online"
    offline = "offline"
    degraded = "degraded"
    archived = "archived"


class CloudTargetEnrollmentStatus(StrEnum):
    pending = "pending"
    consumed = "consumed"
    expired = "expired"
    revoked = "revoked"


class CloudTargetUpdateStatus(StrEnum):
    idle = "idle"
    staging = "staging"
    staged = "staged"
    applying = "applying"
    applied = "applied"
    failed = "failed"
    rolled_back = "rolled_back"


class CloudTargetUpdateChannel(StrEnum):
    stable = "stable"
    beta = "beta"
    pinned = "pinned"


SUPPORTED_CLOUD_TARGET_KINDS: tuple[str, ...] = tuple(kind.value for kind in CloudTargetKind)
SUPPORTED_CLOUD_TARGET_PROFILE_ROLES: tuple[str, ...] = tuple(
    role.value for role in CloudTargetProfileRole
)
SUPPORTED_ENROLLABLE_CLOUD_TARGET_KINDS: tuple[str, ...] = (
    CloudTargetKind.ssh.value,
    CloudTargetKind.desktop_dispatch.value,
    CloudTargetKind.self_hosted_cloud.value,
)
SUPPORTED_CLOUD_TARGET_STATUSES: tuple[str, ...] = tuple(
    status.value for status in CloudTargetStatus
)
SUPPORTED_CLOUD_WORKER_STATUSES: tuple[str, ...] = tuple(
    status.value for status in CloudWorkerStatus
)
SUPPORTED_CLOUD_TARGET_ENROLLMENT_STATUSES: tuple[str, ...] = tuple(
    status.value for status in CloudTargetEnrollmentStatus
)
SUPPORTED_CLOUD_TARGET_UPDATE_STATUSES: tuple[str, ...] = tuple(
    status.value for status in CloudTargetUpdateStatus
)
SUPPORTED_CLOUD_TARGET_UPDATE_CHANNELS: tuple[str, ...] = tuple(
    channel.value for channel in CloudTargetUpdateChannel
)

CLOUD_TARGET_ENROLLMENT_TOKEN_DOMAIN: Final = "cloud-target-enrollment"
CLOUD_WORKER_TOKEN_DOMAIN: Final = "cloud-worker"
CLOUD_TARGET_DEFAULT_ENROLLMENT_TTL_SECONDS: Final = 3600
CLOUD_TARGET_MAX_ENROLLMENT_TTL_SECONDS: Final = 86_400
CLOUD_TARGET_HEARTBEAT_STALE_SECONDS: Final = 180

# ---------------------------------------------------------------------------
# Runtime workers (cloud sandbox + desktop) auth
# ---------------------------------------------------------------------------
# HMAC domains keep the three token families independent even if a raw token
# value ever collides across systems.
CLOUD_RUNTIME_WORKER_ENROLLMENT_TOKEN_DOMAIN: Final = "cloud-runtime-worker-enrollment"
CLOUD_RUNTIME_WORKER_TOKEN_DOMAIN: Final = "cloud-runtime-worker"
CLOUD_INTEGRATION_GATEWAY_TOKEN_DOMAIN: Final = "cloud-integration-gateway"

# Cloud sandboxes mint a longer-lived enrollment (the worker boots once per
# provisioning); desktop mints a short-lived one at login.
CLOUD_RUNTIME_WORKER_CLOUD_ENROLLMENT_TTL_SECONDS: Final = 3600
CLOUD_RUNTIME_WORKER_DESKTOP_ENROLLMENT_TTL_SECONDS: Final = 900
# Heartbeat cadence advertised to the worker + the read-time offline threshold.
CLOUD_RUNTIME_WORKER_HEARTBEAT_INTERVAL_SECONDS: Final = 30
CLOUD_RUNTIME_WORKER_OFFLINE_THRESHOLD_SECONDS: Final = 90
CLOUD_INTEGRATION_GATEWAY_MCP_PATH: Final = "/v1/cloud/integration-gateway/mcp"


# ---------------------------------------------------------------------------
# Cloud commands
# ---------------------------------------------------------------------------


class CloudCommandKind(StrEnum):
    start_session = "start_session"
    configure_git_identity = "configure_git_identity"
    ensure_repo_checkout = "ensure_repo_checkout"
    materialize_workspace = "materialize_workspace"
    prune_workspace_worktree = "prune_workspace_worktree"
    materialize_environment = "materialize_environment"
    refresh_agent_auth_config = "refresh_agent_auth_config"
    reconcile_agents = "reconcile_agents"
    send_prompt = "send_prompt"
    decide_plan = "decide_plan"
    resolve_interaction = "resolve_interaction"
    update_session_config = "update_session_config"
    cancel_turn = "cancel_turn"
    close_session = "close_session"
    backfill_exposed_workspace = "backfill_exposed_workspace"


class CloudCommandStatus(StrEnum):
    queued = "queued"
    leased = "leased"
    delivered = "delivered"
    accepted = "accepted"
    accepted_but_queued = "accepted_but_queued"
    rejected = "rejected"
    expired = "expired"
    superseded = "superseded"
    failed_delivery = "failed_delivery"


class CloudCommandActorKind(StrEnum):
    user = "user"
    automation = "automation"
    slack = "slack"
    api_key = "api_key"
    system = "system"


class CloudCommandSource(StrEnum):
    web = "web"
    mobile = "mobile"
    slack = "slack"
    api = "api"
    automation = "automation"
    desktop_cloud_view = "desktop_cloud_view"


SUPPORTED_CLOUD_COMMAND_KINDS: tuple[str, ...] = tuple(kind.value for kind in CloudCommandKind)
ACTIVE_CLOUD_COMMAND_KINDS: tuple[str, ...] = (
    CloudCommandKind.start_session.value,
    CloudCommandKind.configure_git_identity.value,
    CloudCommandKind.ensure_repo_checkout.value,
    CloudCommandKind.materialize_workspace.value,
    CloudCommandKind.prune_workspace_worktree.value,
    CloudCommandKind.materialize_environment.value,
    CloudCommandKind.refresh_agent_auth_config.value,
    CloudCommandKind.reconcile_agents.value,
    CloudCommandKind.send_prompt.value,
    CloudCommandKind.decide_plan.value,
    CloudCommandKind.resolve_interaction.value,
    CloudCommandKind.update_session_config.value,
    CloudCommandKind.cancel_turn.value,
    CloudCommandKind.close_session.value,
    CloudCommandKind.backfill_exposed_workspace.value,
)
DEFAULT_CLOUD_WORKER_COMMAND_KINDS: tuple[str, ...] = (
    CloudCommandKind.start_session.value,
    CloudCommandKind.configure_git_identity.value,
    CloudCommandKind.ensure_repo_checkout.value,
    CloudCommandKind.materialize_workspace.value,
    CloudCommandKind.materialize_environment.value,
    CloudCommandKind.send_prompt.value,
    CloudCommandKind.decide_plan.value,
    CloudCommandKind.resolve_interaction.value,
    CloudCommandKind.update_session_config.value,
    CloudCommandKind.cancel_turn.value,
    CloudCommandKind.close_session.value,
)
PHASE3_CLOUD_COMMAND_KINDS: tuple[str, ...] = DEFAULT_CLOUD_WORKER_COMMAND_KINDS
SUPPORTED_CLOUD_COMMAND_STATUSES: tuple[str, ...] = tuple(
    status.value for status in CloudCommandStatus
)
SUPPORTED_CLOUD_COMMAND_ACTOR_KINDS: tuple[str, ...] = tuple(
    actor_kind.value for actor_kind in CloudCommandActorKind
)
SUPPORTED_CLOUD_COMMAND_SOURCES: tuple[str, ...] = tuple(
    source.value for source in CloudCommandSource
)

CLOUD_COMMAND_DEFAULT_LEASE_SECONDS: Final = 30
CLOUD_COMMAND_MAX_LEASE_SECONDS: Final = 300
CLOUD_COMMAND_MAX_PAYLOAD_BYTES: Final = 262_144


class CloudTargetConfigStatus(StrEnum):
    pending = "pending"
    queued = "queued"
    materializing = "materializing"
    applied = "applied"
    failed = "failed"


SUPPORTED_CLOUD_TARGET_CONFIG_STATUSES: tuple[str, ...] = tuple(
    status.value for status in CloudTargetConfigStatus
)
