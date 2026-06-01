"""Agent-auth results concern."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from proliferate.constants.cloud import (
    CloudAgentKind,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store.cloud_agent_auth.records import (
    AgentAuthCredentialRecord,
    AgentAuthCredentialShareRecord,
    AgentGatewayBudgetSubjectRecord,
    AgentGatewayFreeCreditEntitlementRecord,
    AgentGatewayPolicyRecord,
    AgentGatewayProviderCredentialRecord,
    SandboxAgentAuthSelectionRecord,
)

_ORG_ADMIN_ROLES = {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN}
_GATEWAY_GRANT_TTL = timedelta(days=7)
_DEFAULT_MANAGED_CREDIT_AGENT_KINDS: tuple[CloudAgentKind, ...] = ("claude",)
_USER_FREE_CREDIT_SOURCE = "signup_free_credit"
_CLEANUP_SELECTION_ERROR_CODES = {
    "credential_revoked",
    "credential_share_revoked",
}
_MANAGED_CODEX_HOME = "/home/user/.proliferate/anyharness/agent-auth/codex"
_OPENCODE_ALLOWED_AUTH_FILES: frozenset[str] = frozenset({".config/opencode/auth.json"})
_TERMINAL_AGENT_AUTH_REFRESH_COMMAND_STATUSES = frozenset(
    {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
        CloudCommandStatus.rejected.value,
        CloudCommandStatus.expired.value,
        CloudCommandStatus.superseded.value,
        CloudCommandStatus.failed_delivery.value,
    }
)


@dataclass(frozen=True)
class CreateGatewayCredentialResult:
    credential: AgentAuthCredentialRecord
    policy: AgentGatewayPolicyRecord
    provider_credential: AgentGatewayProviderCredentialRecord


@dataclass(frozen=True)
class EnsureManagedCreditsResult:
    budget_subject: AgentGatewayBudgetSubjectRecord
    credentials: tuple[AgentAuthCredentialRecord, ...]
    policies: tuple[AgentGatewayPolicyRecord, ...]


@dataclass(frozen=True)
class BifrostRuntimeVirtualKeyResult:
    virtual_key: str
    virtual_key_id: str
    expires_at_iso: str


@dataclass(frozen=True)
class FreeManagedCreditReadyAgentModel:
    agent_kind: str
    public_model_names: tuple[str, ...]
    credential_id: UUID


@dataclass(frozen=True)
class EnsureFreeManagedCreditsResult:
    status: str
    launch_enabled: bool
    primary_action: str
    ready_agent_models: tuple[FreeManagedCreditReadyAgentModel, ...]
    entitlement: AgentGatewayFreeCreditEntitlementRecord | None
    budget_subject: AgentGatewayBudgetSubjectRecord | None
    credentials: tuple[AgentAuthCredentialRecord, ...]
    policies: tuple[AgentGatewayPolicyRecord, ...]
    last_error_code: str | None
    last_error_message: str | None


@dataclass(frozen=True)
class CredentialListItem:
    credential: AgentAuthCredentialRecord
    active_share: AgentAuthCredentialShareRecord | None


@dataclass(frozen=True)
class SyncSyncedCredentialResult:
    credential: AgentAuthCredentialRecord
    selection: SandboxAgentAuthSelectionRecord
    changed: bool


@dataclass(frozen=True)
class AgentGatewayReconcilePassResult:
    budgets_checked: int
    budgets_reconciled: int
    budgets_failed: int
    policies_checked: int
    policies_reconciled: int
    policies_failed: int


@dataclass(frozen=True)
class RuntimeGrantFreshnessReconcilePassResult:
    grants_checked: int
    targets_refreshed: int
    grants_skipped: int
    grants_failed: int
