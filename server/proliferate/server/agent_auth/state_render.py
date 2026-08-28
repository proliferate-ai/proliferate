"""Agent-auth state rendering (state.json v2).

Renders the declarative AUTH-ONLY contract document that AnyHarness turns into
per-harness launch profiles (the agent-auth state.json delivery contract). The
runtime persists it at ``<anyharness home>/agent-auth/state.json`` (mode 0600):

.. code-block:: json

    {
      "version": 2,
      "sequence": 41,
      "lineage": "8a6f...-uuid",
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
``sources: []`` — absent means native, present-but-empty fails closed — and
carries ``unsatisfied_reason``, the plain words naming why (the frozen
``UNSATISFIED_*`` vocabulary below; first-drop-wins). There is
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

``render_agent_auth_state`` operates on pre-scoped inputs;
``build_agent_auth_state`` loads them for a surface (``state_inputs.py``).

Delivery governance (agent_auth spec §2 "How delivery is governed"):
``sequence`` is monotonic per (user, surface) and bumped ONLY by a render
whose ``harnesses`` content changed — the persisted counter lives in
``agent_auth_render_sequence`` and moves through one atomic upsert keyed on
the content hash. Content changes that touch no selection row bump too: a
vault key or seat revoke, a virtual-key rotation, budget withholding, an
enrollment reaching synced — they all change what the renderer emits, which
is the only thing the counter watches. A no-op render changes neither the
sequence nor the fingerprint. The ``fingerprint`` is the sha256 of the
canonical ``harnesses`` array ONLY (``agent_auth_harnesses_fingerprint``) —
a ``GET /state`` response rider, never inside the document.

Empty state (contract §3): a harness ABSENT from ``harnesses`` renders to the
native delta at the read plane; a harness PRESENT with ``sources: []`` fails the
launch closed with a typed error. A gateway source whose enrollment is not yet
synced, or whose public base URL is unconfigured, is dropped (and logged)
rather than raised, and a revoked ``api_key`` source's value simply vanishes
at the next pass — one unsatisfiable source never aborts the whole render,
but it does leave its harness entry empty rather than removing it.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import logging
from collections.abc import Mapping, Sequence
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.agent_gateway import (
    AGENT_AUTH_SEAT_CAPABLE_HARNESS_KINDS,
    AGENT_AUTH_SOURCE_API_KEY,
    AGENT_AUTH_SOURCE_GATEWAY,
    AGENT_AUTH_SOURCE_PROVIDER_CONFIG,
    AGENT_AUTH_SOURCE_SEAT,
    AGENT_AUTH_STATE_VERSION,
    AGENT_AUTH_SURFACE_CLOUD,
    AGENT_GATEWAY_SYNC_STATUS_SYNCED,
)
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store.agent_gateway import AgentAuthSelectionRecord
from proliferate.server.agent_auth.provider_env import (
    translate_provider_config_env as _translate_provider_config_env,
)
from proliferate.server.agent_auth.state_inputs import (
    AgentAuthStateInputs,
    load_state_inputs,
)

__all__ = [
    "AgentAuthStateInputs",
    "agent_auth_harnesses_fingerprint",
    "build_agent_auth_state",
    "render_agent_auth_state",
]

logger = logging.getLogger("proliferate.cloud.materialization")

# The refusal vocabulary (agent_auth spec §2: "the refusal names the actual
# reason"). A present-but-empty harness entry carries `unsatisfied_reason` —
# the plain words the runtime's SourceUnsatisfied refusal shows a human, so
# the strings ARE the contract (pinned by the contract fixture): change one
# only by changing the fixture. First-drop-wins when several sources dropped;
# a harness with any rendered source never carries a reason.
UNSATISFIED_GATEWAY_NOT_READY = "managed model access isn't ready on this account yet"
UNSATISFIED_GATEWAY_BUDGET = "the team is out of LLM credits"
UNSATISFIED_KEY_REVOKED = "its API key was revoked or removed"
UNSATISFIED_SEATS_GONE = "its Claude.ai login was removed or signed out"
UNSATISFIED_UNSUPPORTED = "this provider configuration isn't supported for this agent"


def render_agent_auth_state(inputs: AgentAuthStateInputs) -> tuple[dict[str, object], str]:
    """Render (state, fingerprint) as a v2 document from pre-scoped inputs.

    The returned document is always a valid v2 shape. ``harnesses`` lists every
    harness the user has an enabled selection row for, INCLUDING one whose every
    source turned out unsatisfiable (revoked key, unsynced gateway) — that entry
    is kept with ``sources: []``, which the runtime reads as "a selection this
    machine cannot honor" and refuses the launch. Only a harness with no
    selection row at all is absent, which the read plane treats as native. The
    fingerprint hashes the ``harnesses`` array only (spec §2): pure content
    change detection, independent of the sequence stamped into the document.

    Never raises for an unsatisfiable source: it is dropped (and logged) so a
    single bad source can never abort the render and leave stale key material
    behind. Dropping a source is not the same as dropping its harness.
    """
    # Every harness the user has SELECTED something for gets a key here, even
    # when its value ends up empty. That distinction is the fail-closed law:
    # `sources: []` says "you selected a route and we could not satisfy it", and
    # the runtime refuses the launch; an ABSENT harness says "you never
    # configured this one" and the runtime uses the native login. Dropping the
    # harness entirely collapsed those two into one, so an exhausted gateway
    # budget silently billed the user's personal provider account.
    by_harness: dict[str, list[tuple[tuple[str, str], dict[str, object]]]] = {
        selection.harness_kind: [] for selection in inputs.selections
    }
    # First drop reason per harness ("refusals name the actual why", spec §2):
    # attached only when the entry ends up present-but-empty below.
    drop_reasons: dict[str, str] = {}

    def note_drop(harness_kind: str, reason: str | None) -> None:
        if reason is not None:
            drop_reasons.setdefault(harness_kind, reason)

    seen_seat_ids: dict[str, set[str]] = {}
    for selection in inputs.selections:
        # A seat selection is the one row that expands to MANY wire sources
        # (the pool, in vault order); every other kind renders at most one.
        # Every expanded seat source shares one sort key, and Python's sort is
        # stable, so vault order survives the per-harness (kind, env) sort.
        # Each active seat renders AT MOST ONCE per harness (spec §2): the
        # kind-counting radio lets a pool row and a pin coexist as one method,
        # and the dedupe keeps the pinned seat's token from rendering twice.
        if selection.source_kind == AGENT_AUTH_SOURCE_SEAT:
            seen = seen_seat_ids.setdefault(selection.harness_kind, set())
            seat_sources, seat_reason = _render_seat_sources(inputs, selection)
            note_drop(selection.harness_kind, seat_reason)
            for seat_source in seat_sources:
                if (seat_id := str(seat_source["seat_id"])) not in seen:
                    seen.add(seat_id)
                    by_harness[selection.harness_kind].append(
                        ((str(seat_source["kind"]), ""), seat_source)
                    )
            continue
        source, reason = _render_source(inputs, selection)
        if source is None:
            note_drop(selection.harness_kind, reason)
            continue
        sort_key = (str(source["kind"]), selection.env_var_name or "")
        by_harness[selection.harness_kind].append((sort_key, source))

    harnesses: list[dict[str, object]] = []
    for harness_kind in sorted(by_harness):
        ordered = sorted(by_harness[harness_kind], key=lambda item: item[0])
        sources = [source for _, source in ordered]
        harness_entry: dict[str, object] = {
            "harness_kind": harness_kind,
            "sources": sources,
        }
        # Present-but-empty names its actual why; a harness with ANY rendered
        # source never carries a reason (first-drop-wins across its drops).
        if not sources and harness_kind in drop_reasons:
            harness_entry["unsatisfied_reason"] = drop_reasons[harness_kind]
        harness_settings = inputs.harness_settings.get(harness_kind)
        if harness_settings:
            harness_entry["settings"] = harness_settings
        harnesses.append(harness_entry)

    state: dict[str, object] = {
        "version": AGENT_AUTH_STATE_VERSION,
        "sequence": inputs.sequence,
        # The counter's birth identity, beside the value it counts: stable
        # across renders for the persisted row's life, reborn only when the
        # row is (a rebuilt database). NEVER part of the fingerprint below —
        # the fingerprint hashes the harnesses array only, so a lineage
        # adoption that leaves content identical cannot read as a content
        # change.
        "lineage": inputs.lineage,
        "user_id": str(inputs.user_id),
        "harnesses": harnesses,
    }
    return state, agent_auth_harnesses_fingerprint(harnesses)


def agent_auth_harnesses_fingerprint(harnesses: Sequence[Mapping[str, object]]) -> str:
    """sha256 hex of the canonical ``harnesses`` array (spec §2's fingerprint).

    Hashes the content array ONLY — never the envelope — so the fingerprint
    is pure change detection: stamping a new sequence into the document (or
    rendering for a different user id) cannot move it.
    """
    canonical = json.dumps(list(harnesses), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _render_source(
    inputs: AgentAuthStateInputs,
    selection: AgentAuthSelectionRecord,
) -> tuple[dict[str, object] | None, str | None]:
    """Render one non-seat selection: ``(source, None)`` or ``(None, reason)``."""
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
    # An unknown source kind is validator-forbidden; defend with the nearest
    # frozen words rather than an entry that refuses without a why.
    return None, UNSATISFIED_UNSUPPORTED


def _render_seat_sources(
    inputs: AgentAuthStateInputs,
    selection: AgentAuthSelectionRecord,
) -> tuple[list[dict[str, object]], str | None]:
    """Expand one seat selection row into its wire sources (spec §2).

    ``api_key_id`` NULL is the pool: every active seat, in vault order — the
    runtime owns which one serves (slice 1: the first; rotation is slice 2).
    A non-null id pins one seat. A revoked/vanished seat is simply absent
    from ``seat_values``, so its source drops and the harness entry fails
    closed at the next pass — the never-abort contract. The env map carries
    the harness's REAL env-var name (the runtime ``.set()``s exact keys) per
    the provider_config wire ruling. Seats are claude-only this slice (the
    validator enforces it); other harnesses' seat rows drop here too.

    Returns ``(sources, reason)`` — the reason is set exactly when the
    expansion came up empty, naming why in the frozen refusal vocabulary.
    """
    if selection.harness_kind not in AGENT_AUTH_SEAT_CAPABLE_HARNESS_KINDS:
        logger.warning(
            "Skipping seat source for harness without a seat recipe (harness=%s)",
            selection.harness_kind,
        )
        # Validator-forbidden state (seats are claude-only this slice); the
        # nearest frozen words are the unsupported-combination row.
        return [], UNSATISFIED_UNSUPPORTED
    seats = inputs.seat_values
    if selection.api_key_id is not None:
        seats = tuple(s for s in seats if s[0] == selection.api_key_id)
    sources: list[dict[str, object]] = [
        {
            "kind": AGENT_AUTH_SOURCE_SEAT,
            "env": {"CLAUDE_CODE_OAUTH_TOKEN": token},
            "seat_id": str(seat_id),
        }
        for seat_id, token in seats
    ]
    return sources, None if sources else UNSATISFIED_SEATS_GONE


def _render_gateway_source(
    inputs: AgentAuthStateInputs,
    selection: AgentAuthSelectionRecord,
) -> tuple[dict[str, object] | None, str | None]:
    """Render a gateway source, or ``(None, reason)`` if it cannot be satisfied.

    Resolves the harness's own access-group-scoped key from the per-harness
    map (model-gateway.md §Account model, R2) — never a single shared key.
    An unsatisfiable gateway source is dropped rather than raised so the rest
    of the state — including the removal of any now-revoked ``api_key``
    material — is still written; enrollment reaching ``synced`` re-triggers
    materialization. A drop distinguishes budget-withheld (the load pass
    consulted the predicate and it said no) from account-not-ready
    (enrollment absent/unsynced, no minted key, no public base URL).
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
        return None, UNSATISFIED_GATEWAY_NOT_READY
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
        if inputs.gateway_budget_available is False:
            return None, UNSATISFIED_GATEWAY_BUDGET
        return None, UNSATISFIED_GATEWAY_NOT_READY
    return {
        "kind": AGENT_AUTH_SOURCE_GATEWAY,
        "base_url": inputs.gateway_base_url,
        "key": virtual_key,
    }, None


def _render_api_key_source(
    inputs: AgentAuthStateInputs,
    selection: AgentAuthSelectionRecord,
) -> tuple[dict[str, object] | None, str | None]:
    if selection.api_key_id is None or selection.env_var_name is None:
        # Malformed row (the write gate forbids it): the referenced material
        # is unreachable, which reads the same as a removed key to the user.
        return None, UNSATISFIED_KEY_REVOKED
    value = inputs.api_key_values.get(selection.api_key_id)
    if value is None:
        # Revoked (or vanished) key: drop the source so the raw key material
        # disappears from the sandbox at this pass. AnyHarness fails closed.
        return None, UNSATISFIED_KEY_REVOKED
    return {
        "kind": AGENT_AUTH_SOURCE_API_KEY,
        "env_var_name": selection.env_var_name,
        "value": value,
    }, None


def _render_provider_config_source(
    inputs: AgentAuthStateInputs,
    selection: AgentAuthSelectionRecord,
) -> tuple[dict[str, object] | None, str | None]:
    """Render a typed vault entry as a ``provider_config`` wire source.

    Per the wire-contract ruling (agent-auth.md's "Delivery: state.json",
    D3 python brief §2): the ``env`` map's keys are ALREADY this harness's
    real env-var names, not the vault's generic storage field names -- Rust's
    render arm never renames anything, it only ``.set()``s exact keys handed
    to it. ``config_kind`` rides along so Rust can pick which render arm to
    run (plain env-set vs. codex's config.toml injection), not to rename a
    field.

    Returns ``(None, reason)`` (dropping the source, never raising) for a
    revoked/vanished vault entry or an unsupported (harness_kind, config_kind)
    combination -- same never-abort-the-render contract as
    ``_render_api_key_source``/``_render_gateway_source``.
    """
    if selection.api_key_id is None:
        return None, UNSATISFIED_KEY_REVOKED
    resolved = inputs.provider_config_values.get(selection.api_key_id)
    if resolved is None:
        # Revoked (or vanished) typed entry: drop the source, same as a bare
        # api_key's revoked-key handling above.
        return None, UNSATISFIED_KEY_REVOKED
    config_kind, fields = resolved
    env = _translate_provider_config_env(selection.harness_kind, config_kind, fields)
    if env is None:
        logger.warning(
            "Skipping unsupported provider-config source harness=%s config_kind=%s",
            selection.harness_kind,
            config_kind,
        )
        return None, UNSATISFIED_UNSUPPORTED
    return {
        "kind": AGENT_AUTH_SOURCE_PROVIDER_CONFIG,
        "config_kind": config_kind,
        "env": env,
    }, None


async def build_agent_auth_state(
    db: AsyncSession,
    user_id: UUID,
    *,
    surface: str = AGENT_AUTH_SURFACE_CLOUD,
) -> tuple[dict[str, object], str]:
    """Load the user's auth material for a surface and render (state, fingerprint).

    The sequence is an output of the render, never an input (spec §2): the
    content is rendered first, its ``harnesses`` hash is fed to the atomic
    ``bump_render_sequence_if_changed`` upsert — which advances the persisted
    per-(user, surface) counter exactly when the hash changed — and the
    returned sequence is stamped into a second render of the same inputs.
    Both passes render identical content (the sequence rides the envelope,
    outside the fingerprint), so a no-op render returns the same (sequence,
    fingerprint) pair it returned last time.

    WRITES. Rendering is not a read: the bump below is an upsert, so every
    caller of this function — including ``GET /state`` and ``GET /selections``,
    which look like plain reads — must run on a session that COMMITS and on a
    writable primary. ``get_async_session`` commits on every happy path
    (``db/engine.py``), which is the only reason those two GETs are correct
    today. If a caller ever stops committing (a read replica, a
    "GETs don't commit" refactor), the served sequence and the persisted
    counter desynchronise and ``ack_auth_state_delivery`` starts rejecting
    every legitimate ack as "from the future" (``service.py``). The coupling is
    pinned by
    ``tests/integration/test_agent_auth_sequence_governance.py::
    test_get_state_commits_the_bumped_sequence_for_an_independent_session``.
    """
    inputs = await load_state_inputs(db, user_id=user_id, surface=surface)
    _, fingerprint = render_agent_auth_state(inputs)
    # The write. See the WRITES paragraph above before moving this behind a
    # read-only session, a replica, or a cache. The lineage comes back from
    # the same statement: the row's birth uuid, stable across renders — a
    # recreated row (rebuilt database) is the only thing that changes it.
    sequence, lineage = await agent_gateway_store.bump_render_sequence_if_changed(
        db,
        user_id=user_id,
        surface=surface,
        fingerprint=fingerprint,
    )
    state, fingerprint = render_agent_auth_state(
        dataclasses.replace(inputs, sequence=sequence, lineage=str(lineage))
    )
    return state, fingerprint
