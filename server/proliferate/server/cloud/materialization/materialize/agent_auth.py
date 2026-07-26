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

``sources`` are the ENABLED rows only (disabled rows never leave the DB). A
harness whose every enabled row is unsatisfiable keeps its entry with
``sources: []`` — absent means native, present-but-empty fails closed. There is
NO ``model_catalog``, NO ``slot``, and NO ``provider`` on the wire —
``provider_hint`` is a UI-only display field the renderer never emits.

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

Empty state (contract §3): a harness ABSENT from ``harnesses`` renders to the
native delta at the read plane; a harness PRESENT with ``sources: []`` fails the
launch closed with a typed error. When the whole surface has no selection rows at
all, the state file and manifest are deleted so the reader finds no file. A
gateway source whose enrollment is not yet synced, or whose public base URL is
unconfigured, is dropped (and logged) rather than raised, and a revoked
``api_key`` source's value simply vanishes at the next pass — one unsatisfiable
source never aborts the whole reconcile, but it does leave its harness entry
empty rather than removing it.
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
from proliferate.server.cloud.agent_gateway.budget import (
    get_gateway_enrollment_for_user,
    is_gateway_budget_available,
)
from proliferate.server.cloud.cloud_sandboxes import transactions as cloud_sandbox_transactions
from proliferate.server.cloud.materialization import operation, paths, sandbox_io

logger = logging.getLogger("proliferate.cloud.materialization")


@dataclass(frozen=True)
class AgentAuthStateInputs:
    """Everything needed to render the state file, decoupled from the DB.

    ``selections`` are the ENABLED rows for the rendered surface only. ``revision``
    is precomputed from every row in the surface (enabled or not) so disabling a
    row still advances it. ``api_key_values`` maps an ``api_key_id`` to its
    decrypted secret; a revoked or vanished key is simply absent (its source is
    then dropped).

    ``gateway_virtual_keys`` is a per-harness map (model-gateway.md §Account
    model, R2): each gateway-capable harness gets its own access-group-scoped
    key, so there is no longer one shared virtual key for a whole scope. A
    harness absent from the map (or whose enrollment isn't synced) has an
    unsatisfiable gateway source.
    """

    user_id: UUID
    revision: int
    selections: tuple[AgentAuthSelectionRecord, ...]
    api_key_values: Mapping[UUID, str]
    enrollment_sync_status: str | None
    gateway_virtual_keys: Mapping[str, str]  # keyed by harness_kind
    gateway_base_url: str | None
    harness_settings: Mapping[str, dict[str, object]]  # keyed by harness_kind


def render_agent_auth_state(inputs: AgentAuthStateInputs) -> tuple[dict[str, object], str]:
    """Render (state, fingerprint) as a v2 document from pre-scoped inputs.

    The returned document is always a valid v2 shape. ``harnesses`` lists every
    harness the user has an enabled selection row for, INCLUDING one whose every
    source turned out unsatisfiable (revoked key, unsynced gateway) — that entry
    is kept with ``sources: []``, which the runtime reads as "a selection this
    machine cannot honor" and refuses the launch. Only a harness with no
    selection row at all is absent, which the read plane treats as native. The
    caller deletes the file when ``harnesses`` is empty, i.e. when nothing is
    selected on this surface at all.

    Never raises for an unsatisfiable source: it is dropped (and logged) so a
    single bad source can never abort the reconcile and leave stale key material
    behind. Dropping a source is not the same as dropping its harness.
    """
    # Every harness the user has SELECTED something for gets a key here, even
    # when its value ends up empty. That distinction is the fail-closed law:
    # `sources: []` says "you selected a route and we could not satisfy it", and
    # the runtime refuses the launch; an ABSENT harness says "you never
    # configured this one" and the runtime uses the native login. Dropping the
    # harness entirely collapsed those two into one, so an exhausted gateway
    # budget silently billed the user's personal provider account.
    by_harness: dict[str, list[tuple[str, dict[str, object]]]] = {
        selection.harness_kind: [] for selection in inputs.selections
    }
    for selection in inputs.selections:
        source = _render_source(inputs, selection)
        if source is None:
            continue
        sort_key = (str(source["kind"]), selection.env_var_name or "")
        by_harness[selection.harness_kind].append((sort_key, source))

    harnesses: list[dict[str, object]] = []
    for harness_kind in sorted(by_harness):
        ordered = sorted(by_harness[harness_kind], key=lambda item: item[0])
        harness_entry: dict[str, object] = {
            "harness_kind": harness_kind,
            "sources": [source for _, source in ordered],
        }
        harness_settings = inputs.harness_settings.get(harness_kind)
        if harness_settings:
            harness_entry["settings"] = harness_settings
        harnesses.append(harness_entry)

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

    Resolves the harness's own access-group-scoped key from the per-harness
    map (model-gateway.md §Account model, R2) — never a single shared key.
    An unsatisfiable gateway source is dropped rather than raised so the rest
    of the state — including the removal of any now-revoked ``api_key``
    material — is still written; enrollment reaching ``synced`` re-triggers
    materialization.
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
    virtual_key = inputs.gateway_virtual_keys.get(selection.harness_kind)
    if not synced or not virtual_key:
        logger.warning(
            "Skipping unsatisfiable gateway agent-auth source harness=%s "
            "(enrollment status=%s, virtual key present=%s)",
            selection.harness_kind,
            inputs.enrollment_sync_status or "none",
            virtual_key is not None,
        )
        return None
    return {
        "kind": AGENT_AUTH_SOURCE_GATEWAY,
        "base_url": inputs.gateway_base_url,
        "key": virtual_key,
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
    gateway_virtual_keys: dict[str, str] = {}
    gateway_harness_kinds = {
        selection.harness_kind
        for selection in enabled
        if selection.source_kind == AGENT_AUTH_SOURCE_GATEWAY
    }
    if gateway_harness_kinds:
        # Org-member gap fix (model-gateway.md): an org member's gateway
        # sessions are governed by their ORG enrollment, not their personal
        # one — same resolution `is_gateway_budget_available` uses below, so
        # the gate and the keys it guards always agree on the paying subject.
        enrollment = await get_gateway_enrollment_for_user(db, user_id)
        if enrollment is not None:
            enrollment_sync_status = enrollment.sync_status
            if enrollment.sync_status == AGENT_GATEWAY_SYNC_STATUS_SYNCED:
                # Second enforcement wall for LLM-credit exhaustion (the first
                # is the importer disabling the LiteLLM virtual keys): an
                # exhausted subject stops being handed any key at all, so a
                # lagging or failed key-disable cannot leak gateway access.
                # The gateway source then renders unsatisfiable and is dropped;
                # the runtime fails closed at launch.
                if await is_gateway_budget_available(db, user_id):
                    for harness_kind in gateway_harness_kinds:
                        enrollment_key = await agent_gateway_store.get_active_enrollment_key(
                            db,
                            enrollment_id=enrollment.id,
                            harness_kind=harness_kind,
                        )
                        if enrollment_key is None:
                            continue
                        decrypted_key = (
                            await agent_gateway_store.get_enrollment_key_virtual_key_decrypted(
                                db,
                                enrollment_key_id=enrollment_key.id,
                            )
                        )
                        if decrypted_key is not None:
                            gateway_virtual_keys[harness_kind] = decrypted_key
                else:
                    logger.warning(
                        "Withholding gateway virtual keys: LLM credit exhausted "
                        "(user=%s, surface=%s)",
                        user_id,
                        surface,
                    )

    harness_settings = await agent_gateway_store.list_harness_settings_for_surface(
        db,
        user_id=user_id,
        surface=surface,
    )

    return AgentAuthStateInputs(
        user_id=user_id,
        revision=revision,
        selections=enabled,
        api_key_values=api_key_values,
        enrollment_sync_status=enrollment_sync_status,
        gateway_virtual_keys=gateway_virtual_keys,
        gateway_base_url=settings.agent_gateway_litellm_public_base_url or None,
        harness_settings=harness_settings,
    )


async def materialize_agent_auth(
    db: AsyncSession,
    *,
    ctx: operation.MaterializationContext,
    user_id: UUID,
) -> None:
    """Reconcile the agent-auth state file inside an already-connected sandbox."""
    state, fingerprint = await build_agent_auth_state(db, user_id)
    # The state read is complete. Release its PostgreSQL transaction before
    # reading or mutating the remote sandbox.
    await cloud_sandbox_transactions.commit_cloud_sandbox_session(db)
    state_path = paths.agent_auth_state_path()
    manifest_path = paths.agent_auth_manifest_path()

    if not state["harnesses"]:
        # NO SELECTIONS AT ALL for this surface — not "selections we could not
        # satisfy". Since the renderer now keeps a `sources: []` entry for every
        # selected harness, an empty `harnesses` list can only mean the user has
        # selected nothing, and deleting the file is exactly right: absent means
        # native. A surface with an unsatisfiable selection reaches the write
        # below with `sources: []`, which the runtime fails closed on.
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
