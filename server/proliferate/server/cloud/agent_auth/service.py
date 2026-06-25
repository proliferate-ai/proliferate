"""Stable service import surface for cloud agent auth."""

from __future__ import annotations

from proliferate.config import settings
from proliferate.integrations.bifrost import BifrostAdminClient
from proliferate.server.cloud.agent_auth.credentials import (
    create_gateway_credential,
    list_credentials,
    list_credentials_for_response,
    sync_synced_credential_for_user,
)
from proliferate.server.cloud.agent_auth.desktop_materialization import (
    desktop_agent_auth_config_apply_request,
    record_desktop_agent_auth_config_status,
)
from proliferate.server.cloud.agent_auth.errors import AgentAuthError
from proliferate.server.cloud.agent_auth.free_credits import ensure_free_managed_credits_for_user
from proliferate.server.cloud.agent_auth.grant_freshness import (
    reconcile_agent_gateway_runtime_grant_freshness,
)
from proliferate.server.cloud.agent_auth.managed_credits import (
    ensure_managed_credits_for_organization,
    sync_managed_credit_budget_for_organization,
)
from proliferate.server.cloud.agent_auth.profiles import (
    ensure_organization_sandbox_profile,
    ensure_personal_sandbox_profile,
)
from proliferate.server.cloud.agent_auth.provider_keys import _bifrost_provider_key_fingerprint
from proliferate.server.cloud.agent_auth.reconciliation import (
    reconcile_agent_gateway_bifrost_router,
)
from proliferate.server.cloud.agent_auth.refresh import (
    request_agent_auth_refresh_for_profile_target,
)
from proliferate.server.cloud.agent_auth.results import (
    AgentGatewayReconcilePassResult,
    BifrostRuntimeVirtualKeyResult,
    CreateGatewayCredentialResult,
    CredentialListItem,
    EnsureFreeManagedCreditsResult,
    EnsureManagedCreditsResult,
    FreeManagedCreditReadyAgentModel,
    RuntimeGrantFreshnessReconcilePassResult,
    SyncSyncedCredentialResult,
)
from proliferate.server.cloud.agent_auth.runtime_keys import (
    _bifrost_public_base_url,
    _issue_bifrost_runtime_virtual_key_for_selection,
)
from proliferate.server.cloud.agent_auth.selections import (
    list_selections,
    list_target_states,
    select_credential_for_profile,
)
from proliferate.server.cloud.agent_auth.sharing import (
    revoke_credential,
    revoke_credential_share,
    share_personal_credential_with_organization,
)
from proliferate.server.cloud.agent_auth.usage_import import import_bifrost_usage_logs
from proliferate.server.cloud.agent_auth.worker_materialization import (
    record_worker_agent_auth_status,
    worker_agent_auth_materialization_plan,
)

__all__ = [
    "AgentAuthError",
    "AgentGatewayReconcilePassResult",
    "BifrostRuntimeVirtualKeyResult",
    "BifrostAdminClient",
    "CreateGatewayCredentialResult",
    "CredentialListItem",
    "desktop_agent_auth_config_apply_request",
    "EnsureFreeManagedCreditsResult",
    "EnsureManagedCreditsResult",
    "FreeManagedCreditReadyAgentModel",
    "RuntimeGrantFreshnessReconcilePassResult",
    "SyncSyncedCredentialResult",
    "_bifrost_provider_key_fingerprint",
    "_bifrost_public_base_url",
    "_issue_bifrost_runtime_virtual_key_for_selection",
    "create_gateway_credential",
    "ensure_free_managed_credits_for_user",
    "ensure_managed_credits_for_organization",
    "ensure_organization_sandbox_profile",
    "ensure_personal_sandbox_profile",
    "import_bifrost_usage_logs",
    "list_credentials",
    "list_credentials_for_response",
    "list_selections",
    "list_target_states",
    "record_desktop_agent_auth_config_status",
    "reconcile_agent_gateway_bifrost_router",
    "reconcile_agent_gateway_runtime_grant_freshness",
    "record_worker_agent_auth_status",
    "request_agent_auth_refresh_for_profile_target",
    "revoke_credential",
    "revoke_credential_share",
    "select_credential_for_profile",
    "share_personal_credential_with_organization",
    "settings",
    "sync_managed_credit_budget_for_organization",
    "sync_synced_credential_for_user",
    "worker_agent_auth_materialization_plan",
]
