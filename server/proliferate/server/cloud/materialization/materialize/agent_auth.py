"""Agent-auth state materialization into cloud sandboxes (state.json v2).

Writes the declarative AUTH-ONLY contract file that AnyHarness renders into
per-harness launch profiles (contract ``codex/p1-auth-contract.md`` §3). The
file lives at ``<anyharness home>/agent-auth/state.json`` (mode 0600):

.. code-block:: json

    {
      "version": 2,
      "revision": 41,
      "user_id": "...",
      "harnesses": [
        {
          "harness_kind": "claude",
          "sources": [
            {"kind": "gateway", "base_url": "https://llm/v1", "key": "<virtual key>"}
          ]
        },
        {
          "harness_kind": "opencode",
          "sources": [
            {"kind": "gateway", "base_url": "https://llm/v1", "key": "<virtual key>"},
            {"kind": "api_key", "env_var_name": "ANTHROPIC_API_KEY", "value": "<raw key>"}
          ]
        }
      ]
    }

``sources`` are the ENABLED rows only (disabled rows never leave the DB); a
harness with no resolvable enabled source is omitted entirely. There is NO
``model_catalog``, NO ``slot``, and NO ``provider`` on the wire — ``provider_hint``
is a UI-only display field the renderer never emits.

Two delivery surfaces share this one renderer: the cloud materialization worker
writes the ``cloud`` surface into sandboxes, and ``GET /agent-gateway/state``
serves the ``local`` surface to the desktop (which pushes it to its local
AnyHarness runtime). ``render_agent_auth_state`` operates on pre-scoped inputs;
``build_agent_auth_state`` loads them for a surface.

``revision`` is derived from ``max(updated_at)`` across the surface's selection
rows (the prior DB rebuild dropped the per-row revision column, so there is no
persistent counter to bump — see the contract §1 note): it is monotonic across
edits that keep the scope non-empty, which is what the runtime's stale-push
protection needs. Content is authoritative — a virtual-key rotation changes the
file without any row mutation, so change detection uses a sha256 fingerprint of
the canonical JSON tracked in a server-owned manifest beside the home:
unchanged fingerprint → no write.

Empty state (contract §3): a harness absent from ``harnesses`` (or with empty
``sources``) renders to the native delta at the read plane. When the whole
surface resolves to zero harnesses, the state file and manifest are deleted so
the reader finds no file (cloud launch fail-closes on its own — that is the Rust
launcher's job, not this file's). A gateway source whose enrollment is not yet
synced, or whose public base URL is unconfigured, is dropped (and logged) rather
than raised, and a revoked ``api_key`` source's value simply vanishes at the next
pass — one unsatisfiable source never aborts the whole reconcile.
"""

from __future__ import annotations

import hashlib
import json
import logging
import shlex
from collections.abc import Mapping
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import (
    AGENT_AUTH_SOURCE_API_KEY,
    AGENT_AUTH_SOURCE_GATEWAY,
    AGENT_AUTH_STATE_VERSION,
    AGENT_AUTH_SURFACE_CLOUD,
    AGENT_GATEWAY_SYNC_STATUS_SYNCED,
)
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store import cloud_sandboxes as cloud_sandboxes_store
from proliferate.db.store.agent_gateway import AgentAuthSelectionRecord
from proliferate.server.cloud.materialization import operation, paths, sandbox_io

logger = logging.getLogger("proliferate.cloud.materialization")

# Per-agent-kind native auth file allowlist (spec §5.4, lines 272-276).
# Only files in this allowlist may be deleted on credential revocation.
# Paths are relative to SANDBOX_HOME (/home/user).
NATIVE_AUTH_FILE_ALLOWLIST: dict[str, tuple[str, ...]] = {
    "claude": (".claude/.credentials.json", ".claude.json"),
    "codex": (".codex/auth.json",),
    "gemini": (".gemini/oauth_creds.json", ".gemini/settings.json"),
    "opencode": (".config/opencode/auth.json",),
}


@dataclass(frozen=True)
class AgentAuthStateInputs:
    """Everything needed to render the state file, decoupled from the DB.

    ``selections`` are the ENABLED rows for the rendered surface only. ``revision``
    is precomputed from every row in the surface (enabled or not) so disabling a
    row still advances it. ``api_key_values`` maps an ``api_key_id`` to its
    decrypted secret; a revoked or vanished key is simply absent (its source is
    then dropped).
    """

    user_id: UUID
    revision: int
    selections: tuple[AgentAuthSelectionRecord, ...]
    api_key_values: Mapping[UUID, str]
    enrollment_sync_status: str | None
    gateway_virtual_key: str | None
    gateway_base_url: str | None


def render_agent_auth_state(inputs: AgentAuthStateInputs) -> tuple[dict[str, object], str]:
    """Render (state, fingerprint) as a v2 document from pre-scoped inputs.

    The returned document is always a valid v2 shape. ``harnesses`` lists only
    the harnesses that have at least one resolvable enabled source; a harness
    whose every source is unsatisfiable (revoked key, unsynced gateway) is
    omitted, which the read plane treats as native. The caller (cloud
    materializer) deletes the file when ``harnesses`` is empty.

    Never raises for an unsatisfiable source: it is dropped (and logged) so a
    single bad source can never abort the reconcile and leave stale key material
    behind.
    """
    by_harness: dict[str, list[tuple[str, dict[str, object]]]] = {}
    for selection in inputs.selections:
        source = _render_source(inputs, selection)
        if source is None:
            continue
        sort_key = (str(source["kind"]), selection.env_var_name or "")
        by_harness.setdefault(selection.harness_kind, []).append((sort_key, source))

    harnesses: list[dict[str, object]] = []
    for harness_kind in sorted(by_harness):
        ordered = sorted(by_harness[harness_kind], key=lambda item: item[0])
        harnesses.append(
            {"harness_kind": harness_kind, "sources": [source for _, source in ordered]}
        )

    state: dict[str, object] = {
        "version": AGENT_AUTH_STATE_VERSION,
        "revision": inputs.revision,
        "user_id": str(inputs.user_id),
        "harnesses": harnesses,
    }
    return state, agent_auth_state_fingerprint(state)


def agent_auth_state_fingerprint(state: Mapping[str, object]) -> str:
    canonical = json.dumps(state, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _render_source(
    inputs: AgentAuthStateInputs,
    selection: AgentAuthSelectionRecord,
) -> dict[str, object] | None:
    if selection.source_kind == AGENT_AUTH_SOURCE_GATEWAY:
        return _render_gateway_source(inputs, selection)
    if selection.source_kind == AGENT_AUTH_SOURCE_API_KEY:
        return _render_api_key_source(inputs, selection)
    return None


def _render_gateway_source(
    inputs: AgentAuthStateInputs,
    selection: AgentAuthSelectionRecord,
) -> dict[str, object] | None:
    """Render a gateway source, or ``None`` if it cannot be satisfied.

    An unsatisfiable gateway source is dropped rather than raised so the rest of
    the state — including the removal of any now-revoked ``api_key`` material —
    is still written; enrollment reaching ``synced`` re-triggers materialization.
    """
    if not inputs.gateway_base_url:
        # L7 (contract): a configured gateway selection that cannot be delivered
        # because the operator has not set the public base URL must be LOUD, not
        # a silent drop — this is an infra misconfiguration, not a user error.
        logger.warning(
            "gateway selection dropped: agent_gateway_litellm_public_base_url "
            "is not configured (harness=%s)",
            selection.harness_kind,
        )
        return None
    synced = inputs.enrollment_sync_status == AGENT_GATEWAY_SYNC_STATUS_SYNCED
    if not synced or not inputs.gateway_virtual_key:
        logger.warning(
            "Skipping unsatisfiable gateway agent-auth source harness=%s "
            "(enrollment status=%s, virtual key present=%s)",
            selection.harness_kind,
            inputs.enrollment_sync_status or "none",
            inputs.gateway_virtual_key is not None,
        )
        return None
    return {
        "kind": AGENT_AUTH_SOURCE_GATEWAY,
        "base_url": inputs.gateway_base_url,
        "key": inputs.gateway_virtual_key,
    }


def _render_api_key_source(
    inputs: AgentAuthStateInputs,
    selection: AgentAuthSelectionRecord,
) -> dict[str, object] | None:
    if selection.api_key_id is None or selection.env_var_name is None:
        return None
    value = inputs.api_key_values.get(selection.api_key_id)
    if value is None:
        # Revoked (or vanished) key: drop the source so the raw key material
        # disappears from the sandbox at this pass. AnyHarness fails closed.
        return None
    return {
        "kind": AGENT_AUTH_SOURCE_API_KEY,
        "env_var_name": selection.env_var_name,
        "value": value,
    }


async def build_agent_auth_state(
    db: AsyncSession,
    user_id: UUID,
    *,
    surface: str = AGENT_AUTH_SURFACE_CLOUD,
) -> tuple[dict[str, object], str]:
    """Load the user's auth material for a surface and render (state, fingerprint)."""
    inputs = await _load_state_inputs(db, user_id=user_id, surface=surface)
    return render_agent_auth_state(inputs)


def _row_revision(row: AgentAuthSelectionRecord) -> int:
    """Monotonic revision contribution of a row (ms since epoch of updated_at)."""
    return int(row.updated_at.timestamp() * 1000)


async def _load_state_inputs(
    db: AsyncSession,
    *,
    user_id: UUID,
    surface: str = AGENT_AUTH_SURFACE_CLOUD,
) -> AgentAuthStateInputs:
    all_rows = tuple(
        await agent_gateway_store.list_auth_selections(db, user_id=user_id, surface=surface)
    )
    enabled = tuple(row for row in all_rows if row.enabled)
    revision = max((_row_revision(row) for row in all_rows), default=0)

    api_key_values: dict[UUID, str] = {}
    for selection in enabled:
        if selection.source_kind != AGENT_AUTH_SOURCE_API_KEY or selection.api_key_id is None:
            continue
        if selection.api_key_id in api_key_values:
            continue
        resolved = await agent_gateway_store.get_agent_api_key_decrypted(
            db,
            user_id=user_id,
            api_key_id=selection.api_key_id,
        )
        if resolved is not None:
            _, value = resolved
            api_key_values[selection.api_key_id] = value

    enrollment_sync_status: str | None = None
    gateway_virtual_key: str | None = None
    needs_gateway = any(
        selection.source_kind == AGENT_AUTH_SOURCE_GATEWAY for selection in enabled
    )
    if needs_gateway:
        enrollment = await agent_gateway_store.get_enrollment_for_user(db, user_id=user_id)
        if enrollment is not None:
            enrollment_sync_status = enrollment.sync_status
            if enrollment.sync_status == AGENT_GATEWAY_SYNC_STATUS_SYNCED:
                gateway_virtual_key = (
                    await agent_gateway_store.get_enrollment_virtual_key_decrypted(
                        db,
                        enrollment_id=enrollment.id,
                    )
                )

    return AgentAuthStateInputs(
        user_id=user_id,
        revision=revision,
        selections=enabled,
        api_key_values=api_key_values,
        enrollment_sync_status=enrollment_sync_status,
        gateway_virtual_key=gateway_virtual_key,
        gateway_base_url=settings.agent_gateway_litellm_public_base_url or None,
    )


async def materialize_agent_auth(
    db: AsyncSession,
    *,
    ctx: operation.MaterializationContext,
    user_id: UUID,
) -> None:
    """Reconcile the agent-auth state file inside an already-connected sandbox."""
    state, fingerprint = await build_agent_auth_state(db, user_id)
    state_path = paths.agent_auth_state_path()
    manifest_path = paths.agent_auth_manifest_path()

    previous = await _read_previous_manifest(ctx)
    current_harnesses = sorted(
        entry["harness_kind"] for entry in state["harnesses"]
    )

    if not state["harnesses"]:
        # No resolvable cloud sources: delete the file so the reader finds none
        # (contract §3 — empty renders to native; cloud launch fail-closes in the
        # runtime launcher, not here).
        await sandbox_io.remove_owned_files(
            ctx.target,
            operation_id=ctx.sandbox.id,
            paths={state_path, manifest_path},
        )
        # Cleanup stale native auth files for all previously-active harnesses.
        await _cleanup_revoked_harness_auth_files(
            ctx, previous_harnesses=previous.get("active_harnesses", []), current_harnesses=[]
        )
        return

    if previous.get("fingerprint") == fingerprint:
        return

    # Cleanup stale native auth files for harnesses that were active but are no
    # longer present (credential revoked / share revoked / profile disabled).
    await _cleanup_revoked_harness_auth_files(
        ctx,
        previous_harnesses=previous.get("active_harnesses", []),
        current_harnesses=current_harnesses,
    )

    await sandbox_io.write_private_file_atomic(
        ctx.target,
        operation_id=ctx.sandbox.id,
        path=state_path,
        content=json.dumps(state, sort_keys=True, indent=2) + "\n",
        mode="600",
    )
    manifest = {
        "fingerprint": fingerprint,
        "path": state_path,
        "revision": state["revision"],
        "active_harnesses": current_harnesses,
    }
    await sandbox_io.write_private_file_atomic(
        ctx.target,
        operation_id=ctx.sandbox.id,
        path=manifest_path,
        content=json.dumps(manifest, sort_keys=True, indent=2) + "\n",
        mode="600",
    )


async def _cleanup_revoked_harness_auth_files(
    ctx: operation.MaterializationContext,
    *,
    previous_harnesses: list[str],
    current_harnesses: list[str],
) -> None:
    """Delete native auth files for harnesses that were previously active but are now absent.

    This closes gap #2 (spec §5.4): when a credential is revoked and its harness
    disappears from the state, stale native auth files (.codex/auth.json,
    .claude/.credentials.json, etc.) must be removed so they cannot be used to
    authenticate after revocation.

    Only files in the per-agent NATIVE_AUTH_FILE_ALLOWLIST are eligible for
    deletion. Any path outside the allowlist is refused and logged.
    """
    if not previous_harnesses:
        return

    revoked_harnesses = set(previous_harnesses) - set(current_harnesses)
    if not revoked_harnesses:
        return

    cleanup_paths: set[str] = set()
    for harness_kind in revoked_harnesses:
        allowed = NATIVE_AUTH_FILE_ALLOWLIST.get(harness_kind)
        if allowed is None:
            logger.warning(
                "cleanup-on-revoke: no allowlist entry for harness_kind=%s; skipping",
                harness_kind,
            )
            continue
        for relative_path in allowed:
            absolute_path = f"{paths.SANDBOX_HOME}/{relative_path}"
            cleanup_paths.add(absolute_path)

    if not cleanup_paths:
        return

    logger.info(
        "cleanup-on-revoke: removing stale auth files for revoked harnesses %s: %s",
        sorted(revoked_harnesses),
        sorted(cleanup_paths),
    )
    await sandbox_io.remove_owned_files(
        ctx.target,
        operation_id=ctx.sandbox.id,
        paths=cleanup_paths,
        allowed_root=paths.SANDBOX_HOME,
    )


async def materialize_agent_auth_for_user(db: AsyncSession, *, user_id: UUID) -> None:
    """Refresh agent-auth state in the user's active personal sandbox.

    Only sandboxes that already have a provider sandbox are refreshed; a
    sandbox that has never booted picks the state up during its full
    bootstrap (``materialize_sandbox``).
    """
    sandbox = await cloud_sandboxes_store.load_personal_cloud_sandbox(db, user_id)
    if sandbox is None or sandbox.destroyed_at is not None or sandbox.status == "destroyed":
        return
    if sandbox.e2b_sandbox_id is None:
        return
    await operation.run_cloud_sandbox_operation(
        db,
        sandbox=sandbox,
        operation_key="agent-auth",
        run=lambda ctx: materialize_agent_auth(db, ctx=ctx, user_id=user_id),
    )


async def _read_previous_manifest(
    ctx: operation.MaterializationContext,
) -> dict[str, object]:
    manifest_path = paths.agent_auth_manifest_path()
    output = await sandbox_io.run_materialization_script(
        ctx.target,
        operation_id=ctx.sandbox.id,
        label="materialization_read_agent_auth_manifest",
        script=f"cat {shlex.quote(manifest_path)} 2>/dev/null || true",
        timeout_seconds=30,
    )
    try:
        decoded = json.loads(output)
    except (json.JSONDecodeError, TypeError):
        return {}
    return decoded if isinstance(decoded, dict) else {}
