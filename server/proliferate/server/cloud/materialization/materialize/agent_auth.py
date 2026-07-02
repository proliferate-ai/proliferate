"""Agent-auth state materialization into cloud sandboxes.

Writes the declarative agent-auth state file that AnyHarness renders into
per-harness launch profiles (spec: agent-auth-litellm §5). The contract file
lives at ``<anyharness home>/agent-auth/state.json`` (mode 0600):

.. code-block:: json

    {
      "revision": 42,
      "user_id": "...",
      "selections": [
        {"harness": "claude", "route": "gateway", "slot": "primary",
         "base_url": "https://llm.example/v1", "key": "<virtual key>"},
        {"harness": "codex", "route": "api_key", "slot": "primary",
         "provider": "openai", "key": "<raw key>"},
        {"harness": "opencode", "route": "gateway", "slot": "gateway",
         "base_url": "https://llm.example/v1", "key": "<virtual key>"},
        {"harness": "opencode", "route": "api_key", "slot": "anthropic",
         "provider": "anthropic", "key": "<raw key>"}
      ]
    }

Multiple entries per harness are allowed (spec §3.3 slot semantics): OpenCode
composes one entry per slot; AnyHarness merges them into a single additive
launch profile and rejects multi-entry state for single-source harnesses.

Rendering is surface-parametric: this module materializes the ``cloud``
surface into sandboxes, while the same render path serves the ``local``
surface over ``GET /agent-gateway/state`` (the desktop pushes that payload to
its local AnyHarness runtime). The local surface additionally renders
``native`` selections — route choice only, never credentials — which the
cloud surface cannot hold by schema constraint. ``revision`` is the max
revision across the user's route-selection rows for the surface; it is informational
for AnyHarness (content is authoritative — a virtual-key rotation changes the
file without bumping any selection revision). Change detection uses a sha256
fingerprint of the canonical state JSON, tracked in a server-owned manifest
file beside the Proliferate home (mirroring the secret-set manifest pattern):
unchanged fingerprint → no write.

Fail-closed contract:

- **No cloud selections at all** → the state file and manifest are deleted, so
  the reader finds no file and legacy/native fall-through is permitted.
- **Cloud selections exist but none currently resolve** (e.g. the sole
  ``api_key`` selection's key was revoked, or a gateway selection whose
  enrollment is not yet synced) → a *fail-closed marker* is still written:
  ``{"revision": …, "selections": []}``. The reader refuses per-harness rather
  than treating an absent file as native fall-through. Never delete the file
  while selections exist.

An ``api_key`` selection whose key has been revoked is omitted, and an
unsatisfiable gateway selection is skipped, so stale (possibly revoked) key
material always disappears at the next pass even when another selection cannot
be rendered — one bad selection never aborts the whole reconcile. Enrollment
that reaches ``synced`` later re-triggers materialization on its own.
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
    AGENT_AUTH_ROUTE_API_KEY,
    AGENT_AUTH_ROUTE_GATEWAY,
    AGENT_AUTH_ROUTE_NATIVE,
    AGENT_AUTH_SURFACE_CLOUD,
    AGENT_GATEWAY_SYNC_STATUS_SYNCED,
)
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store import cloud_sandboxes as cloud_sandboxes_store
from proliferate.db.store.agent_gateway import AgentAuthRouteSelectionRecord
from proliferate.server.cloud.materialization import operation, paths, sandbox_io

logger = logging.getLogger("proliferate.cloud.materialization")


@dataclass(frozen=True)
class AgentAuthStateInputs:
    """Everything needed to render the state file, decoupled from the DB."""

    user_id: UUID
    selections: tuple[AgentAuthRouteSelectionRecord, ...]
    # api_key_id -> (provider, decrypted secret); revoked keys are absent.
    api_key_secrets: Mapping[UUID, tuple[str, str]]
    enrollment_sync_status: str | None
    gateway_virtual_key: str | None
    gateway_base_url: str | None


def render_agent_auth_state(
    inputs: AgentAuthStateInputs,
    *,
    surface: str = AGENT_AUTH_SURFACE_CLOUD,
) -> tuple[dict[str, object] | None, str]:
    """Render (state, fingerprint) for one surface from inputs.

    Returns ``(None, "")`` only when the user has **no selections for the
    surface at all** — the state file is then deleted (cloud) or served as a
    revision-0 legacy marker (local) and the reader may fall through to
    native. When surface selections exist but none currently resolve (revoked
    ``api_key``, unsynced gateway, missing config), a fail-closed marker with
    an empty ``selections`` list is returned so the file is still written and
    the reader refuses per-harness instead of falling through.

    ``native`` selections (local surface only, by schema constraint) render as
    route-choice-only entries — no key material exists for them anywhere.

    Never raises for an unsatisfiable selection: it is skipped (and logged) so
    a single bad selection can never abort the reconcile and leave stale key
    material behind.
    """
    surface_selections = [
        selection for selection in inputs.selections if selection.surface == surface
    ]
    if not surface_selections:
        return None, ""

    rendered: list[dict[str, object]] = []
    for selection in sorted(
        surface_selections,
        key=lambda item: (item.harness_kind, item.slot),
    ):
        entry: dict[str, object] | None = None
        if selection.route == AGENT_AUTH_ROUTE_GATEWAY:
            entry = _render_gateway_selection(inputs, selection)
        elif selection.route == AGENT_AUTH_ROUTE_API_KEY:
            entry = _render_api_key_selection(inputs, selection)
        elif selection.route == AGENT_AUTH_ROUTE_NATIVE:
            entry = _render_native_selection(selection)
        if entry is not None:
            rendered.append(entry)

    # Surface selections exist: always emit a state file. An empty
    # ``selections`` list is a deliberate fail-closed marker (not a deletion)
    # so revoked/stale secret material is purged and the reader refuses
    # per-harness.
    state: dict[str, object] = {
        "revision": max(selection.revision for selection in surface_selections),
        "user_id": str(inputs.user_id),
        "selections": rendered,
    }
    return state, agent_auth_state_fingerprint(state)


def agent_auth_state_fingerprint(state: Mapping[str, object]) -> str:
    canonical = json.dumps(state, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _render_gateway_selection(
    inputs: AgentAuthStateInputs,
    selection: AgentAuthRouteSelectionRecord,
) -> dict[str, object] | None:
    """Render a gateway selection, or ``None`` if it cannot be satisfied.

    An unsatisfiable gateway selection (unsynced enrollment, missing virtual
    key, or unconfigured public base URL) is skipped rather than raised: the
    harness fails closed for this pass while the rest of the state — including
    the removal of any now-revoked ``api_key`` material — is still written.
    Enrollment reaching ``synced`` re-triggers materialization.
    """
    reason: str | None = None
    if inputs.enrollment_sync_status != AGENT_GATEWAY_SYNC_STATUS_SYNCED:
        reason = f"enrollment not synced (status={inputs.enrollment_sync_status or 'none'})"
    elif not inputs.gateway_base_url:
        reason = "agent_gateway_litellm_public_base_url is not configured"
    elif not inputs.gateway_virtual_key:
        reason = "enrollment has no virtual key"
    if reason is not None:
        logger.warning(
            "Skipping unsatisfiable gateway agent-auth selection harness=%s reason=%s",
            selection.harness_kind,
            reason,
        )
        return None
    return {
        "harness": selection.harness_kind,
        "route": AGENT_AUTH_ROUTE_GATEWAY,
        "slot": selection.slot,
        "base_url": inputs.gateway_base_url,
        "key": inputs.gateway_virtual_key,
    }


def _render_api_key_selection(
    inputs: AgentAuthStateInputs,
    selection: AgentAuthRouteSelectionRecord,
) -> dict[str, object] | None:
    if selection.api_key_id is None:
        return None
    resolved = inputs.api_key_secrets.get(selection.api_key_id)
    if resolved is None:
        # Revoked (or vanished) key: drop the entry so the raw key material
        # disappears from the sandbox at this pass. AnyHarness fails closed.
        return None
    provider, secret = resolved
    return {
        "harness": selection.harness_kind,
        "route": AGENT_AUTH_ROUTE_API_KEY,
        "slot": selection.slot,
        "provider": provider,
        "key": secret,
    }


def _render_native_selection(
    selection: AgentAuthRouteSelectionRecord,
) -> dict[str, object]:
    """Render a native selection: the route choice only, never credentials."""
    return {
        "harness": selection.harness_kind,
        "route": AGENT_AUTH_ROUTE_NATIVE,
        "slot": selection.slot,
    }


async def build_agent_auth_state(
    db: AsyncSession,
    user_id: UUID,
    *,
    surface: str = AGENT_AUTH_SURFACE_CLOUD,
) -> tuple[dict[str, object] | None, str]:
    """Load the user's auth material for a surface and render (state, fingerprint)."""
    inputs = await _load_state_inputs(db, user_id=user_id, surface=surface)
    return render_agent_auth_state(inputs, surface=surface)


async def _load_state_inputs(
    db: AsyncSession,
    *,
    user_id: UUID,
    surface: str = AGENT_AUTH_SURFACE_CLOUD,
) -> AgentAuthStateInputs:
    selections = tuple(await agent_gateway_store.list_route_selections(db, user_id=user_id))
    surface_selections = [selection for selection in selections if selection.surface == surface]

    api_key_secrets: dict[UUID, tuple[str, str]] = {}
    for selection in surface_selections:
        if selection.route != AGENT_AUTH_ROUTE_API_KEY or selection.api_key_id is None:
            continue
        resolved = await agent_gateway_store.get_agent_api_key_decrypted(
            db,
            user_id=user_id,
            api_key_id=selection.api_key_id,
        )
        if resolved is not None:
            record, secret = resolved
            api_key_secrets[selection.api_key_id] = (record.provider, secret)

    enrollment_sync_status: str | None = None
    gateway_virtual_key: str | None = None
    needs_gateway = any(
        selection.route == AGENT_AUTH_ROUTE_GATEWAY for selection in surface_selections
    )
    if needs_gateway:
        enrollment = await agent_gateway_store.get_enrollment_for_user(db, user_id=user_id)
        if enrollment is not None:
            enrollment_sync_status = enrollment.sync_status
            gateway_virtual_key = await agent_gateway_store.get_enrollment_virtual_key_decrypted(
                db,
                enrollment_id=enrollment.id,
            )

    return AgentAuthStateInputs(
        user_id=user_id,
        selections=selections,
        api_key_secrets=api_key_secrets,
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

    if state is None:
        await sandbox_io.remove_owned_files(
            ctx.target,
            operation_id=ctx.sandbox.id,
            paths={state_path, manifest_path},
        )
        return

    previous = await _read_previous_manifest(ctx)
    if previous.get("fingerprint") == fingerprint:
        return

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
    }
    await sandbox_io.write_private_file_atomic(
        ctx.target,
        operation_id=ctx.sandbox.id,
        path=manifest_path,
        content=json.dumps(manifest, sort_keys=True, indent=2) + "\n",
        mode="600",
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
