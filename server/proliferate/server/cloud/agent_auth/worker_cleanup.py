"""Agent-auth worker cleanup concern."""

from __future__ import annotations

import json
from collections.abc import Sequence
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
)
from proliferate.server.cloud.agent_auth.errors import AgentAuthError
from proliferate.server.cloud.agent_auth.synced_files import (
    _decrypt_synced_payload,
    _native_auth_file_paths,
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


async def _missing_worker_cleanup_paths(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    applied_cleanup_paths: set[str],
) -> list[str]:
    expected: set[str] = set()
    state = await store.get_target_state(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
    )
    if state is not None:
        for entry in _pending_cleanup_entries_from_json(state.pending_cleanup_json):
            expected.update(_cleanup_entry_paths(entry))
    for selection in await store.list_selections_for_profile(db, sandbox_profile_id):
        expected.update(await _cleanup_paths_for_selection(db, selection))
    return sorted(path for path in expected if path not in applied_cleanup_paths)


def _pending_cleanup_entries_from_json(value: str | None) -> tuple[dict[str, object], ...]:
    if not value:
        return ()
    try:
        parsed = json.loads(value)
    except ValueError:
        return ()
    if not isinstance(parsed, list):
        return ()
    return tuple(entry for entry in parsed if isinstance(entry, dict))


def _cleanup_entry_paths(entry: dict[str, object]) -> tuple[str, ...]:
    paths = entry.get("paths")
    if not isinstance(paths, list):
        return ()
    return tuple(sorted({path for path in paths if isinstance(path, str) and path.strip()}))


async def _pending_cleanup_entries_for_selection(
    db: AsyncSession,
    selection: SandboxAgentAuthSelectionRecord,
    *,
    reason: str,
) -> list[dict[str, object]]:
    if reason not in _CLEANUP_SELECTION_ERROR_CODES:
        return []
    if selection.materialization_mode != "synced_files":
        return []
    paths = await _cleanup_paths_from_credential_payload(db, selection)
    if not paths:
        return []
    return [
        {
            "agentKind": selection.agent_kind,
            "authSlotId": selection.auth_slot_id,
            "credentialId": str(selection.credential_id),
            "credentialRevision": selection.selected_revision,
            "credentialShareId": (
                str(selection.credential_share_id)
                if selection.credential_share_id is not None
                else None
            ),
            "materializationMode": selection.materialization_mode,
            "paths": list(paths),
            "reason": reason,
        }
    ]


def _pending_cleanup_json(entries: Sequence[dict[str, object]] | None) -> str | None:
    if not entries:
        return None
    return json.dumps(list(entries), separators=(",", ":"), sort_keys=True)


async def _cleanup_paths_for_selection(
    db: AsyncSession,
    selection: SandboxAgentAuthSelectionRecord,
) -> tuple[str, ...]:
    if selection.status != "invalid":
        return ()
    if selection.materialization_mode != "synced_files":
        return ()
    if selection.last_error_code not in _CLEANUP_SELECTION_ERROR_CODES:
        return ()
    return await _cleanup_paths_from_credential_payload(db, selection)


async def _cleanup_paths_from_credential_payload(
    db: AsyncSession,
    selection: SandboxAgentAuthSelectionRecord,
) -> tuple[str, ...]:
    credential = await store.get_credential(db, selection.credential_id)
    if credential is None or credential.payload_ciphertext is None:
        return ()
    try:
        payload = _decrypt_synced_payload(credential)
    except AgentAuthError:
        return ()
    files = payload.get("files")
    if not isinstance(files, dict):
        return ()
    allowed_paths = set(_native_auth_file_paths(selection.agent_kind, selection.auth_slot_id))
    return tuple(sorted(path for path in files if isinstance(path, str) and path in allowed_paths))
