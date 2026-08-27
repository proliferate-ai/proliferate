"""Agent-auth state materialization into cloud sandboxes (state.json v2).

Writes the declarative AUTH-ONLY contract file that AnyHarness renders into
per-harness launch profiles (the agent-auth state.json delivery contract). The
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
        },
        {
          "harness_kind": "codex",
          "sources": [
            {
              "kind": "provider_config",
              "config_kind": "aws_bedrock",
              "env": {"AWS_BEARER_TOKEN_BEDROCK": "<raw token>", "AWS_REGION": "us-east-1"}
            }
          ]
        }
      ]
    }

``sources`` are the ENABLED rows only (disabled rows never leave the DB). A
harness whose every enabled row is unsatisfiable keeps its entry with
``sources: []`` — absent means native, present-but-empty fails closed. There is
NO ``model_catalog``, NO ``slot``, and NO ``provider`` on the wire —
``provider_hint`` is a UI-only display field the renderer never emits.

A ``provider_config`` source is a typed vault entry (``kind`` column on
``AgentApiKey``: ``aws_bedrock``/``azure_openai``) rendered by
``_render_provider_config_source``. Its ``env`` map's keys are ALREADY this
harness's real env-var names (``AWS_REGION``, ``AZURE_API_KEY``, etc.) —
Python resolves the vault's generic field names
(``region``/``bearerToken``/``endpoint``/``deployment``/``apiKey``) into them
before the document ever reaches Rust, so the runtime never learns
provider-config internals; ``config_kind`` rides along only so Rust can pick
which render arm to run (plain env-set vs. codex's config.toml injection),
never to rename a field. The DB ``source_kind`` for this row is still
``api_key`` — the ``provider_config`` distinction exists only on the wire,
decided at render time by which vault ``kind`` the referenced row has.

Two delivery surfaces share this one renderer: the cloud materialization worker
writes the ``cloud`` surface into sandboxes, and ``GET /agent-auth/state``
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
from collections.abc import Mapping
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import (
    AGENT_API_KEY_KIND_AWS_BEDROCK,
    AGENT_API_KEY_KIND_AZURE_OPENAI,
    AGENT_AUTH_SOURCE_API_KEY,
    AGENT_AUTH_SOURCE_GATEWAY,
    AGENT_AUTH_SOURCE_PROVIDER_CONFIG,
    AGENT_AUTH_STATE_VERSION,
    AGENT_AUTH_SURFACE_CLOUD,
    AGENT_GATEWAY_SYNC_STATUS_SYNCED,
)
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store.agent_gateway import AgentAuthSelectionRecord
from proliferate.server.ai_gateway.budget import (
    get_gateway_enrollment_for_user,
    is_gateway_budget_available,
)

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

    ``provider_config_values`` maps an ``api_key_id`` to ``(kind, fields)`` for
    every ENABLED ``api_key`` selection whose referenced vault entry is a TYPED
    entry (``aws_bedrock``/``azure_openai``) rather than a bare secret --
    ``fields`` is the decrypted generic vault field map (D2's vocabulary:
    ``region``/``bearerToken``/``endpoint``/``deployment``/``apiKey``), not yet
    translated into any harness's env vars (D3 python brief §4.1/§4.2 --
    ``_render_provider_config_source`` does that at render time, per selection,
    since the SAME vault entry can be selected by more than one harness and
    each harness needs its own translation). A revoked or vanished typed entry
    is simply absent here too (its source is then dropped, same as
    ``api_key_values``).
    """

    user_id: UUID
    revision: int
    selections: tuple[AgentAuthSelectionRecord, ...]
    api_key_values: Mapping[UUID, str]
    provider_config_values: Mapping[UUID, tuple[str, dict[str, str]]]
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
        # The DB source_kind stays 'api_key' for both a bare secret AND a
        # typed vault entry (D1 deliberately did not add a third DB value --
        # see AGENT_AUTH_SOURCE_PROVIDER_CONFIG's docstring). Which wire kind
        # this renders as is decided here, by which map the referenced
        # api_key_id resolved into.
        if selection.api_key_id in inputs.provider_config_values:
            return _render_provider_config_source(inputs, selection)
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
    has_minted_key = virtual_key is not None
    if not synced or not virtual_key:
        logger.warning(
            "Skipping unsatisfiable gateway agent-auth source harness=%s "
            "(enrollment status=%s, minted key present=%s)",
            selection.harness_kind,
            inputs.enrollment_sync_status or "none",
            has_minted_key,
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


def _render_provider_config_source(
    inputs: AgentAuthStateInputs,
    selection: AgentAuthSelectionRecord,
) -> dict[str, object] | None:
    """Render a typed vault entry as a ``provider_config`` wire source.

    Per the wire-contract ruling (agent-auth.md's "Delivery: state.json",
    D3 python brief §2): the ``env`` map's keys are ALREADY this harness's
    real env-var names, not the vault's generic storage field names -- Rust's
    render arm never renames anything, it only ``.set()``s exact keys handed
    to it. ``config_kind`` rides along so Rust can pick which render arm to
    run (plain env-set vs. codex's config.toml injection), not to rename a
    field.

    Returns ``None`` (dropping the source, never raising) for a
    revoked/vanished vault entry or an unsupported (harness_kind, config_kind)
    combination -- same never-abort-the-reconcile contract as
    ``_render_api_key_source``/``_render_gateway_source``.
    """
    if selection.api_key_id is None:
        return None
    resolved = inputs.provider_config_values.get(selection.api_key_id)
    if resolved is None:
        # Revoked (or vanished) typed entry: drop the source, same as a bare
        # api_key's revoked-key handling above.
        return None
    config_kind, fields = resolved
    env = _translate_provider_config_env(selection.harness_kind, config_kind, fields)
    if env is None:
        logger.warning(
            "Skipping unsupported provider-config source harness=%s config_kind=%s",
            selection.harness_kind,
            config_kind,
        )
        return None
    return {
        "kind": AGENT_AUTH_SOURCE_PROVIDER_CONFIG,
        "config_kind": config_kind,
        "env": env,
    }


def _hostname_first_label(endpoint: str) -> str:
    """The Azure resource name: the first label of ``endpoint``'s hostname.

    Live-test-proven vocabulary (ledger 2026-07-26 opencode×azure entry):
    ``https://proliferate-gw-aoai.openai.azure.com`` (or a bare
    ``proliferate-gw-aoai.openai.azure.com``, or even a bare
    ``proliferate-gw-aoai``) -> ``proliferate-gw-aoai``. Tolerates a scheme, a
    path/query suffix, userinfo (``user@host``), a port, and a bare
    hostname/resource-name value (no scheme at all) uniformly by stripping a
    scheme if present, taking the host:port portion before any path,
    dropping any userinfo before ``@`` and any port after ``:``, then
    splitting on the first ``.``. D2's stored-vault ``endpoint`` field is
    never expected to carry userinfo or a port in practice, but this
    function's contract is "first label of the hostname", so it strips both
    rather than silently folding them into the returned label.
    """
    value = endpoint.strip()
    if "://" in value:
        value = value.split("://", 1)[1]
    value = value.split("/", 1)[0]
    if "@" in value:
        value = value.rsplit("@", 1)[1]
    value = value.split(":", 1)[0]
    return value.split(".", 1)[0]


def _translate_provider_config_env(
    harness_kind: str,
    config_kind: str,
    fields: Mapping[str, str],
) -> dict[str, str] | None:
    """Generic vault fields -> this harness's real env-var names.

    Mirrors registry.json's ``providerConfig[].envVars`` vocabulary for
    (harness_kind, config_kind) EXACTLY -- this table's output keys must be
    the literal names D1 declared, or D3-rust's generic ``.set()`` loop
    silently emits the wrong variable. Returns ``None`` for an unsupported or
    pending combination so the caller drops the source (same as an
    unsatisfiable gateway/api_key source -- never raises).

    D3 brief §4.2's ruled table. One mapping — claude's ``azure_openai``
    (Foundry) row — is explicitly flagged as an unverified judgment call
    pending a Gate 4 live run (not a solved problem inherited from D1/D2):
    its vault entry has no field distinct from "resource" or "auth token"
    (see the brief's §0 contradiction writeup), so this row bundles two
    judgment calls rather than one settled fact — (1) the resource name is
    derived from `endpoint`'s hostname by analogy to opencode's
    live-test-proven `AZURE_RESOURCE_NAME` rule below, applied here to
    claude's `ANTHROPIC_FOUNDRY_RESOURCE` without its own live test, and
    (2) `ANTHROPIC_FOUNDRY_AUTH_TOKEN` is left unset, treating it and
    `ANTHROPIC_FOUNDRY_API_KEY` as alternatives (mirroring the existing
    `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` pair) rather than populating
    both. Gate 4's live claude×azure_openai run is what settles both; each
    is a one-line fix in the block below if the live run shows either
    backwards.
    """
    if config_kind == AGENT_API_KEY_KIND_AWS_BEDROCK:
        region = fields.get("region")
        bearer_token = fields.get("bearerToken")
        if not region or not bearer_token:
            return None
        if harness_kind == "claude":
            return {
                "CLAUDE_CODE_USE_BEDROCK": "1",
                "AWS_BEARER_TOKEN_BEDROCK": bearer_token,
                "AWS_REGION": region,
            }
        if harness_kind in ("codex", "opencode"):
            return {
                "AWS_BEARER_TOKEN_BEDROCK": bearer_token,
                "AWS_REGION": region,
            }
        return None

    if config_kind == AGENT_API_KEY_KIND_AZURE_OPENAI:
        endpoint = fields.get("endpoint")
        api_key = fields.get("apiKey")
        if not endpoint or not api_key:
            return None
        if harness_kind == "claude":
            # Foundry: 3 vault fields (endpoint/deployment/apiKey) -> 4 env
            # vars. UNVERIFIED judgment call (brief §0/§4.2, §8 item 4): the
            # resource name is derived from endpoint's hostname (same rule as
            # opencode's proven AZURE_RESOURCE_NAME derivation below);
            # ANTHROPIC_FOUNDRY_AUTH_TOKEN is left unset, treating it and
            # ANTHROPIC_FOUNDRY_API_KEY as alternatives (mirrors the existing
            # ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN pair). Gate 4's live
            # claude×azure_openai run is what settles this; if it shows the
            # mapping backwards, swap which field populates which var.
            return {
                "CLAUDE_CODE_USE_FOUNDRY": "1",
                "ANTHROPIC_FOUNDRY_RESOURCE": _hostname_first_label(endpoint),
                "ANTHROPIC_FOUNDRY_BASE_URL": endpoint,
                "ANTHROPIC_FOUNDRY_API_KEY": api_key,
            }
        if harness_kind == "opencode":
            # Live-test-proven (ledger 2026-07-26): AZURE_OPENAI_API_KEY is
            # dead code in the pinned opencode binary; AZURE_API_KEY +
            # AZURE_RESOURCE_NAME (bare resource name, derived from
            # endpoint's hostname) is the working pair. `deployment` is
            # deliberately NOT translated here -- it folds into a
            # `--model azure/<id>` launch argument, which is outside
            # state.json's env+files wire contract (brief §4.2/§8 item 3,
            # open question -- flagged, not solved, by this arm).
            return {
                "AZURE_API_KEY": api_key,
                "AZURE_RESOURCE_NAME": _hostname_first_label(endpoint),
            }
        # codex×azure_openai: structurally excluded (D1 marked it `pending`;
        # `supported_provider_config_kinds` already excludes it from what a
        # selection may reference), but defend here too rather than trust
        # that gate alone -- a working codex arm needs config.toml
        # model_providers injection (D3-rust, gated on its own Gate 4 cell),
        # not a plain env map.
        return None

    return None


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
    provider_config_values: dict[UUID, tuple[str, dict[str, str]]] = {}
    for selection in enabled:
        if selection.source_kind != AGENT_AUTH_SOURCE_API_KEY or selection.api_key_id is None:
            continue
        if (
            selection.api_key_id in api_key_values
            or selection.api_key_id in provider_config_values
        ):
            continue
        # Try the bare-key fetch first (mirrors `get_agent_api_key_decrypted`'s
        # kind-scoped query, which already returns None for a typed row) --
        # fall back to the typed fetch only when the bare one misses, so a
        # selection referencing either vault shape resolves without the
        # caller needing to know which shape it is in advance.
        resolved = await agent_gateway_store.get_agent_api_key_decrypted(
            db,
            user_id=user_id,
            api_key_id=selection.api_key_id,
        )
        if resolved is not None:
            _, value = resolved
            api_key_values[selection.api_key_id] = value
            continue
        typed_resolved = await agent_gateway_store.get_agent_provider_config_decrypted(
            db,
            user_id=user_id,
            api_key_id=selection.api_key_id,
        )
        if typed_resolved is not None:
            record, fields = typed_resolved
            provider_config_values[selection.api_key_id] = (record.kind, fields)

    enrollment_sync_status: str | None = None
    gateway_virtual_keys: dict[str, str] = {}
    gateway_harness_kinds = {
        selection.harness_kind
        for selection in enabled
        if selection.source_kind == AGENT_AUTH_SOURCE_GATEWAY
    }
    if gateway_harness_kinds:
        # v1 payer law (model-gateway.md §Account model): gateway sessions are
        # governed by the user's DEFAULT org's enrollment, unconditionally —
        # same resolution `is_gateway_budget_available` uses below, so the
        # gate and the keys it guards always agree on the paying subject.
        enrollment = await get_gateway_enrollment_for_user(db, user_id)
        if enrollment is not None:
            enrollment_sync_status = enrollment.sync_status
            if enrollment.sync_status == AGENT_GATEWAY_SYNC_STATUS_SYNCED:
                # Second enforcement wall for exhausted AND unfunded subjects
                # (the first is the importer disabling the LiteLLM virtual
                # keys, backstopped by the mirrored team budget sitting at the
                # exhausted floor): such a subject stops being handed any key
                # at all, so a lagging or failed key-disable cannot leak
                # gateway access. The gateway source then renders
                # unsatisfiable and is dropped; the runtime fails closed at
                # launch.
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
                        "or subject unfunded (user=%s, surface=%s)",
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
        provider_config_values=provider_config_values,
        enrollment_sync_status=enrollment_sync_status,
        gateway_virtual_keys=gateway_virtual_keys,
        gateway_base_url=settings.agent_gateway_litellm_public_base_url or None,
        harness_settings=harness_settings,
    )
