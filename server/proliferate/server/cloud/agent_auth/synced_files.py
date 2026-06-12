"""Agent-auth synced files concern."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudAgentKind, CloudCommandStatus
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store.cloud_agent_auth.records import (
    AgentAuthCredentialRecord,
    SandboxAgentAuthSelectionRecord,
)
from proliferate.server.cloud.agent_auth.domain.synced_payload import (
    synced_payload_provider_matches,
)
from proliferate.server.cloud.agent_auth.errors import AgentAuthError
from proliferate.server.cloud.agent_auth.models import (
    WorkerAgentAuthSyncedFilesConfig,
)
from proliferate.server.cloud.agent_auth.protected_env import reject_unallowed_protected_env
from proliferate.server.cloud.agent_auth.registry import cleanup_file_paths_for_slot
from proliferate.utils.crypto import decrypt_json

_ORG_ADMIN_ROLES = {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN}
_GATEWAY_GRANT_TTL = timedelta(days=7)
_DEFAULT_MANAGED_CREDIT_AGENT_KINDS: tuple[CloudAgentKind, ...] = ("claude",)
_USER_FREE_CREDIT_SOURCE = "signup_free_credit"
_CLEANUP_SELECTION_ERROR_CODES = {
    "credential_revoked",
    "credential_share_revoked",
}
_MANAGED_CODEX_HOME = "/home/user/.proliferate/anyharness/agent-auth/codex"
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


def _native_auth_file_paths(agent_kind: str, auth_slot_id: str) -> tuple[str, ...]:
    return tuple(sorted(cleanup_file_paths_for_slot(agent_kind, auth_slot_id)))


def _reject_unallowed_selection_protected_env(
    *,
    agent_kind: str,
    auth_slot_id: str,
    materialization_mode: str,
    protected_env: dict[str, str],
) -> None:
    try:
        reject_unallowed_protected_env(
            agent_kind=agent_kind,
            auth_slot_id=auth_slot_id,
            materialization_mode=materialization_mode,
            keys=set(protected_env),
        )
    except ValueError as exc:
        raise AgentAuthError(
            str(exc),
            code="agent_auth_protected_env_not_allowed",
            status_code=409,
        ) from exc


async def _worker_synced_files_config(
    db: AsyncSession,
    credential: AgentAuthCredentialRecord,
    selection: SandboxAgentAuthSelectionRecord,
) -> WorkerAgentAuthSyncedFilesConfig:
    payload = _decrypt_synced_payload(credential)
    raw_env_vars = payload.get("envVars")
    env_vars = {
        key: value
        for key, value in (raw_env_vars if isinstance(raw_env_vars, dict) else {}).items()
        if isinstance(key, str) and isinstance(value, str)
    }
    raw_files = payload.get("files")
    files = [
        {"relativePath": relative_path, "content": content}
        for relative_path, content in (raw_files if isinstance(raw_files, dict) else {}).items()
        if isinstance(relative_path, str) and isinstance(content, str)
    ]
    if not env_vars and not files:
        raise AgentAuthError(
            "Synced credential payload is empty.",
            code="synced_credential_payload_invalid",
            status_code=409,
        )
    _reject_unallowed_selection_protected_env(
        agent_kind=selection.agent_kind,
        auth_slot_id=selection.auth_slot_id,
        materialization_mode=selection.materialization_mode,
        protected_env=env_vars,
    )
    return WorkerAgentAuthSyncedFilesConfig(
        credentialShareId=selection.credential_share_id,
        envVars=env_vars,
        files=files,
        cleanup=[],
    )


def _decrypt_synced_payload(credential: AgentAuthCredentialRecord) -> dict[str, object]:
    if credential.payload_ciphertext is None:
        raise AgentAuthError(
            "Synced credential is missing its source payload.",
            code="synced_credential_source_missing",
            status_code=409,
        )
    payload = decrypt_json(credential.payload_ciphertext)
    if not isinstance(payload, dict) or not synced_payload_provider_matches(
        payload_provider=payload.get("provider"),
        credential_provider_id=credential.credential_provider_id,
        redacted_summary_json=credential.redacted_summary_json,
    ):
        raise AgentAuthError(
            "Synced credential payload is invalid.",
            code="synced_credential_payload_invalid",
            status_code=409,
        )
    return payload
