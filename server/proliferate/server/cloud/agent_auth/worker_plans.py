"""Agent-auth worker plans concern."""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CloudAgentKind,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_agent_auth.records import (
    SandboxAgentAuthSelectionRecord,
    SandboxProfileAgentAuthTargetStateRecord,
    SandboxProfileRecord,
)
from proliferate.server.cloud.agent_auth.errors import AgentAuthError
from proliferate.server.cloud.agent_auth.gateway_policies import (
    _require_credential_ready_for_selection,
)
from proliferate.server.cloud.agent_auth.models import (
    WorkerAgentAuthSelectionPlan,
    WorkerAgentAuthSyncedFilesConfig,
)
from proliferate.server.cloud.agent_auth.runtime_keys import _worker_gateway_config
from proliferate.server.cloud.agent_auth.synced_files import _worker_synced_files_config
from proliferate.server.cloud.agent_auth.worker_cleanup import (
    _cleanup_entry_paths,
    _cleanup_paths_for_selection,
    _pending_cleanup_entries_from_json,
)
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext

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


async def _worker_selection_plan(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    profile: SandboxProfileRecord,
    selection: SandboxAgentAuthSelectionRecord,
) -> WorkerAgentAuthSelectionPlan:
    credential = await store.get_credential(db, selection.credential_id)
    if credential is None or credential.revoked_at is not None:
        raise AgentAuthError("Credential not found.", code="credential_not_found", status_code=404)
    if selection.selected_revision != credential.revision:
        raise AgentAuthError(
            "Selection is stale.",
            code="selection_revision_stale",
            status_code=409,
        )
    await _require_credential_ready_for_selection(db, credential)
    if selection.materialization_mode == "gateway_env":
        gateway = await _worker_gateway_config(
            db,
            auth=auth,
            profile=profile,
            selection=selection,
        )
        return WorkerAgentAuthSelectionPlan(
            agentKind=selection.agent_kind,
            authSlotId=selection.auth_slot_id,
            materializationMode=selection.materialization_mode,
            credentialId=credential.id,
            credentialRevision=credential.revision,
            status=selection.status,
            credentialShareId=selection.credential_share_id,
            gateway=gateway,
            syncedFiles=None,
        )
    if selection.materialization_mode == "synced_files":
        synced_files = await _worker_synced_files_config(db, credential, selection)
        return WorkerAgentAuthSelectionPlan(
            agentKind=selection.agent_kind,
            authSlotId=selection.auth_slot_id,
            materializationMode=selection.materialization_mode,
            credentialId=credential.id,
            credentialRevision=credential.revision,
            status=selection.status,
            credentialShareId=selection.credential_share_id,
            gateway=None,
            syncedFiles=synced_files,
        )
    raise AgentAuthError(
        "Unsupported materialization mode.",
        code="unsupported_materialization_mode",
        status_code=400,
    )


async def _worker_cleanup_selection_plan(
    db: AsyncSession,
    selection: SandboxAgentAuthSelectionRecord,
) -> WorkerAgentAuthSelectionPlan | None:
    if selection.status != "invalid":
        return None
    if selection.materialization_mode != "synced_files":
        return None
    if selection.last_error_code not in _CLEANUP_SELECTION_ERROR_CODES:
        return None
    cleanup_paths = await _cleanup_paths_for_selection(db, selection)
    cleanup = [
        {
            "relativePath": relative_path,
            "reason": selection.last_error_code,
        }
        for relative_path in cleanup_paths
    ]
    if not cleanup:
        return None
    return WorkerAgentAuthSelectionPlan(
        agentKind=selection.agent_kind,
        authSlotId=selection.auth_slot_id,
        materializationMode=selection.materialization_mode,
        credentialId=selection.credential_id,
        credentialRevision=selection.selected_revision,
        status=selection.status,
        credentialShareId=selection.credential_share_id,
        gateway=None,
        syncedFiles=WorkerAgentAuthSyncedFilesConfig(
            credentialShareId=selection.credential_share_id,
            envVars={},
            files=[],
            cleanup=cleanup,
        ),
    )


def _worker_cleanup_plans_from_state(
    target_state: SandboxProfileAgentAuthTargetStateRecord,
) -> list[WorkerAgentAuthSelectionPlan]:
    plans: list[WorkerAgentAuthSelectionPlan] = []
    for entry in _pending_cleanup_entries_from_json(target_state.pending_cleanup_json):
        plan = _worker_cleanup_plan_from_entry(entry)
        if plan is not None:
            plans.append(plan)
    return plans


def _worker_cleanup_plan_from_entry(
    entry: dict[str, object],
) -> WorkerAgentAuthSelectionPlan | None:
    try:
        credential_id = UUID(str(entry["credentialId"]))
    except (KeyError, TypeError, ValueError):
        return None
    agent_kind = entry.get("agentKind")
    auth_slot_id = entry.get("authSlotId")
    materialization_mode = entry.get("materializationMode")
    credential_revision = entry.get("credentialRevision")
    if (
        not isinstance(agent_kind, str)
        or not isinstance(auth_slot_id, str)
        or not isinstance(materialization_mode, str)
    ):
        return None
    if not isinstance(credential_revision, int) or isinstance(credential_revision, bool):
        return None
    credential_share_id = _optional_uuid_value(entry.get("credentialShareId"))
    cleanup = [
        {"relativePath": path, "reason": entry.get("reason") or "credential_revoked"}
        for path in _cleanup_entry_paths(entry)
    ]
    if not cleanup:
        return None
    return WorkerAgentAuthSelectionPlan(
        agentKind=agent_kind,
        authSlotId=auth_slot_id,
        materializationMode=materialization_mode,
        credentialId=credential_id,
        credentialRevision=credential_revision,
        status="invalid",
        credentialShareId=credential_share_id,
        gateway=None,
        syncedFiles=WorkerAgentAuthSyncedFilesConfig(
            credentialShareId=credential_share_id,
            envVars={},
            files=[],
            cleanup=cleanup,
        ),
    )


def _optional_uuid_value(value: object) -> UUID | None:
    if value is None:
        return None
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None
