"""Agent-auth refresh concern."""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CloudAgentKind,
    CloudCommandActorKind,
    CloudCommandKind,
    CloudCommandSource,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db import session_ops as db_session
from proliferate.db.store import cloud_sandboxes
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_agent_auth.records import (
    SandboxAgentAuthSelectionRecord,
    SandboxProfileAgentAuthTargetStateRecord,
    SandboxProfileRecord,
)
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.server.cloud.agent_auth.errors import AgentAuthError
from proliferate.server.cloud.agent_auth.worker_cleanup import (
    _pending_cleanup_entries_for_selection,
    _pending_cleanup_json,
)
from proliferate.server.cloud.commands.domain.rules import compact_command_json
from proliferate.server.cloud.live.service import (
    publish_command_status_after_commit,
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


async def _kick_agent_auth_refresh_wake_after_commit(
    db: AsyncSession,
    command: commands_store.CloudCommandSnapshot,
) -> None:
    if command.status in _TERMINAL_AGENT_AUTH_REFRESH_COMMAND_STATUSES:
        return

    async def _wake_after_commit() -> None:
        from proliferate.server.cloud.runtime.wake import kick_off_managed_slot_wake

        kick_off_managed_slot_wake(command.target_id, command.id)

    await db_session.run_after_commit(db, _wake_after_commit)


async def _bump_profile_for_selection(
    db: AsyncSession,
    selection: SandboxAgentAuthSelectionRecord,
    *,
    actor_user_id: UUID,
    reason: str,
    force_restart: bool,
) -> None:
    pending_cleanup = await _pending_cleanup_entries_for_selection(
        db,
        selection,
        reason=reason,
    )
    updated_profile = await store.bump_sandbox_profile_agent_auth_revision(
        db,
        sandbox_profile_id=selection.sandbox_profile_id,
        reason=reason,
        actor_user_id=actor_user_id,
        force_restart=force_restart,
    )
    if updated_profile is not None:
        await _mark_target_pending_and_queue_refresh(
            db,
            profile=updated_profile,
            actor_user_id=actor_user_id,
            reason=reason,
            force_restart=force_restart,
            pending_cleanup=pending_cleanup,
        )
    await store.revoke_runtime_grants_for_selection(db, selection_id=selection.id)


async def _mark_target_pending_and_queue_refresh(
    db: AsyncSession,
    *,
    profile: SandboxProfileRecord,
    actor_user_id: UUID | None,
    reason: str,
    force_restart: bool,
    pending_cleanup: Sequence[dict[str, object]] | None = None,
) -> None:
    if profile.primary_target_id is None:
        return
    command = await _queue_agent_auth_refresh_command(
        db,
        profile=profile,
        target_id=profile.primary_target_id,
        actor_user_id=actor_user_id,
        reason=reason,
        force_restart=force_restart,
    )
    pending_kwargs: dict[str, object] = {}
    if pending_cleanup is not None:
        pending_kwargs["pending_cleanup_json"] = _pending_cleanup_json(pending_cleanup)
    await store.upsert_target_state(
        db,
        sandbox_profile_id=profile.id,
        target_id=profile.primary_target_id,
        desired_revision=profile.agent_auth_revision,
        applied_revision=None,
        status="pending",
        force_restart_required=force_restart,
        last_command_id=command.id,
        last_worker_id=None,
        last_error_code=None,
        last_error_message=None,
        **pending_kwargs,
    )


async def _ensure_profile_target_refresh_if_needed(
    db: AsyncSession,
    *,
    profile: SandboxProfileRecord,
    actor_user_id: UUID | None,
    reason: str,
) -> None:
    if profile.primary_target_id is None:
        return
    if profile.agent_auth_revision == 0:
        selections = await store.list_selections_for_profile(db, profile.id)
        if not selections:
            return
    state = await store.get_target_state(
        db,
        sandbox_profile_id=profile.id,
        target_id=profile.primary_target_id,
    )
    if (
        state is not None
        and state.desired_revision == profile.agent_auth_revision
        and state.last_command_id is not None
    ):
        return
    await _mark_target_pending_and_queue_refresh(
        db,
        profile=profile,
        actor_user_id=actor_user_id,
        reason=reason,
        force_restart=False,
    )


async def request_agent_auth_refresh_for_profile_target(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    actor_user_id: UUID | None,
    reason: str,
    force_restart: bool,
) -> None:
    profile = await store.get_sandbox_profile(db, sandbox_profile_id)
    if profile is None:
        raise AgentAuthError(
            "Sandbox profile not found.",
            code="sandbox_profile_not_found",
            status_code=404,
        )
    if profile.primary_target_id != target_id:
        raise AgentAuthError(
            "Sandbox profile target does not match the requested target.",
            code="sandbox_profile_target_mismatch",
            status_code=409,
        )
    existing_state = await store.get_target_state(
        db,
        sandbox_profile_id=profile.id,
        target_id=target_id,
    )
    active_slot = await cloud_sandboxes.load_active_slot_for_profile_target(
        db,
        sandbox_profile_id=profile.id,
        target_id=target_id,
    )
    if _agent_auth_target_state_is_current(
        existing_state,
        profile=profile,
        force_restart=force_restart,
        active_slot=active_slot,
    ):
        return
    command = await _queue_agent_auth_refresh_command(
        db,
        profile=profile,
        target_id=target_id,
        actor_user_id=actor_user_id,
        reason=reason,
        force_restart=force_restart,
        existing_state=existing_state,
        active_slot=active_slot,
    )
    await store.upsert_target_state(
        db,
        sandbox_profile_id=profile.id,
        target_id=target_id,
        desired_revision=profile.agent_auth_revision,
        applied_revision=None,
        status="pending",
        force_restart_required=force_restart,
        last_command_id=command.id,
        last_worker_id=None,
        last_error_code=None,
        last_error_message=None,
    )


async def _queue_agent_auth_refresh_command(
    db: AsyncSession,
    *,
    profile: SandboxProfileRecord,
    target_id: UUID,
    actor_user_id: UUID | None,
    reason: str,
    force_restart: bool,
    existing_state: SandboxProfileAgentAuthTargetStateRecord | None = None,
    active_slot: cloud_sandboxes.SlotSnapshot | None = None,
) -> commands_store.CloudCommandSnapshot:
    idempotency_scope = f"target:{target_id}:agent-auth-config:{profile.id}"
    base_idempotency_key = (
        f"agent-auth-config:{target_id}:{profile.id}:{profile.agent_auth_revision}:"
        f"{reason}:{int(force_restart)}"
    )
    idempotency_key = base_idempotency_key
    existing = await commands_store.get_command_by_idempotency(
        db,
        idempotency_scope=idempotency_scope,
        idempotency_key=idempotency_key,
    )
    if existing is not None:
        if not _agent_auth_refresh_command_requires_retry(
            existing,
            existing_state=existing_state,
            profile=profile,
            force_restart=force_restart,
            active_slot=active_slot,
        ):
            await publish_command_status_after_commit(db, existing)
            await _kick_agent_auth_refresh_wake_after_commit(db, existing)
            return existing
        idempotency_key = (
            f"{base_idempotency_key}:retry:{_agent_auth_retry_marker(existing_state)}"
        )
        retry_existing = await commands_store.get_command_by_idempotency(
            db,
            idempotency_scope=idempotency_scope,
            idempotency_key=idempotency_key,
        )
        if retry_existing is not None:
            await publish_command_status_after_commit(db, retry_existing)
            await _kick_agent_auth_refresh_wake_after_commit(db, retry_existing)
            return retry_existing
    payload = {
        "sandboxProfileId": str(profile.id),
        "revision": profile.agent_auth_revision,
        "reason": reason,
        "forceRestart": force_restart,
    }
    actor_kind = (
        CloudCommandActorKind.user.value
        if actor_user_id is not None
        else CloudCommandActorKind.system.value
    )
    try:
        async with db.begin_nested():
            command = await commands_store.create_command(
                db,
                idempotency_scope=idempotency_scope,
                idempotency_key=idempotency_key,
                target_id=target_id,
                organization_id=profile.organization_id,
                actor_user_id=actor_user_id,
                actor_kind=actor_kind,
                source=CloudCommandSource.api.value,
                workspace_id=None,
                session_id=None,
                cloud_workspace_id=None,
                kind=CloudCommandKind.refresh_agent_auth_config.value,
                payload_json=compact_command_json(payload) or "{}",
                observed_event_seq=None,
                preconditions_json=None,
                authorization_context_json=compact_command_json(
                    {
                        "actorUserId": str(actor_user_id) if actor_user_id else None,
                        "sandboxProfileId": str(profile.id),
                        "targetOwnerScope": profile.owner_scope,
                        "targetOrganizationId": (
                            str(profile.organization_id) if profile.organization_id else None
                        ),
                    }
                ),
            )
    except Exception as exc:
        if not db_session.is_integrity_error(exc):
            raise
        duplicate = await commands_store.get_command_by_idempotency(
            db,
            idempotency_scope=idempotency_scope,
            idempotency_key=idempotency_key,
        )
        if duplicate is None:
            raise
        command = duplicate
    await publish_command_status_after_commit(db, command)
    await _kick_agent_auth_refresh_wake_after_commit(db, command)
    return command


def _agent_auth_target_state_is_current(
    state: SandboxProfileAgentAuthTargetStateRecord | None,
    *,
    profile: SandboxProfileRecord,
    force_restart: bool,
    active_slot: cloud_sandboxes.SlotSnapshot | None = None,
) -> bool:
    slot_matches = active_slot is None or (
        state is not None
        and state.active_sandbox_id == active_slot.id
        and state.slot_generation == active_slot.slot_generation
    )
    return (
        not force_restart
        and state is not None
        and state.status == "applied"
        and state.applied_revision is not None
        and state.applied_revision >= profile.agent_auth_revision
        and slot_matches
        and not state.force_restart_required
    )


def _agent_auth_refresh_command_requires_retry(
    command: commands_store.CloudCommandSnapshot,
    *,
    existing_state: SandboxProfileAgentAuthTargetStateRecord | None,
    profile: SandboxProfileRecord,
    force_restart: bool,
    active_slot: cloud_sandboxes.SlotSnapshot | None = None,
) -> bool:
    if command.status not in _TERMINAL_AGENT_AUTH_REFRESH_COMMAND_STATUSES:
        return False
    return not _agent_auth_target_state_is_current(
        existing_state,
        profile=profile,
        force_restart=force_restart,
        active_slot=active_slot,
    )


def _agent_auth_retry_marker(
    existing_state: SandboxProfileAgentAuthTargetStateRecord | None,
) -> str:
    if existing_state is None:
        return "missing"
    marker = (
        f"{existing_state.id}:{existing_state.status}:"
        f"{existing_state.desired_revision}:{existing_state.updated_at.isoformat()}"
    )
    return hashlib.sha256(marker.encode("utf-8")).hexdigest()[:16]
