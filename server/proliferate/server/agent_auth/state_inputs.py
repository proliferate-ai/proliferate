"""DB load pass for the agent-auth state renderer (internal to agent_auth).

Split out of ``state_render.py`` (its line budget): everything needed to turn
a (user, surface) into :class:`AgentAuthStateInputs` — the pure renderer's
whole world, decoupled from the DB. Not part of the system's public surface;
``state_render.build_agent_auth_state`` is the door.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import (
    AGENT_AUTH_SOURCE_API_KEY,
    AGENT_AUTH_SOURCE_GATEWAY,
    AGENT_AUTH_SOURCE_SEAT,
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

    ``selections`` are the ENABLED rows for the rendered surface only.
    ``sequence`` is the document's delivery-order field (spec §2: monotonic
    per (user, surface), bumped only by content-changing renders); the load
    pass leaves it 0 and ``build_agent_auth_state`` stamps the real value
    after hashing the rendered content — the sequence is an output of the
    render, never an input to it. ``lineage`` is stamped the same way (the
    persisted counter row's birth uuid, stable across renders for the row's
    life); the load pass leaves it "". ``api_key_values`` maps an
    ``api_key_id`` to its decrypted secret; a revoked or vanished key is
    simply absent (its source is then dropped).

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

    ``seat_values`` is every ACTIVE seat (``anthropic_subscription``) entry's
    ``(id, decrypted token)``, **in vault order** (``created_at``) — the order
    a pool seat row expands in (spec §2's "seat selection shape"). A revoked
    seat is simply absent, so its source vanishes at the next render pass.

    ``gateway_budget_available`` is the budget predicate's verdict when the
    load pass consulted ``is_gateway_budget_available`` (``None`` when it was
    never consulted): ``False`` is how the renderer knows a missing virtual
    key means budget-withheld rather than an account that isn't ready.
    """

    user_id: UUID
    sequence: int
    lineage: str
    selections: tuple[AgentAuthSelectionRecord, ...]
    api_key_values: Mapping[UUID, str]
    provider_config_values: Mapping[UUID, tuple[str, dict[str, str]]]
    enrollment_sync_status: str | None
    gateway_virtual_keys: Mapping[str, str]  # keyed by harness_kind
    gateway_base_url: str | None
    harness_settings: Mapping[str, dict[str, object]]  # keyed by harness_kind
    seat_values: tuple[tuple[UUID, str], ...] = ()
    gateway_budget_available: bool | None = None


async def load_state_inputs(
    db: AsyncSession,
    *,
    user_id: UUID,
    surface: str = AGENT_AUTH_SURFACE_CLOUD,
) -> AgentAuthStateInputs:
    all_rows = tuple(
        await agent_gateway_store.list_auth_selections(db, user_id=user_id, surface=surface)
    )
    enabled = tuple(row for row in all_rows if row.enabled)

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
    gateway_budget_available: bool | None = None
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
                # launch. The verdict rides the inputs so the renderer can
                # name budget-withheld in the entry's unsatisfied_reason.
                gateway_budget_available = await is_gateway_budget_available(db, user_id)
                if gateway_budget_available:
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

    seat_values: tuple[tuple[UUID, str], ...] = ()
    if any(selection.source_kind == AGENT_AUTH_SOURCE_SEAT for selection in enabled):
        seat_values = tuple(
            (record.id, token)
            for record, token in await agent_gateway_store.list_agent_seats_decrypted(
                db, user_id=user_id
            )
        )

    harness_settings = await agent_gateway_store.list_harness_settings_for_surface(
        db,
        user_id=user_id,
        surface=surface,
    )

    return AgentAuthStateInputs(
        user_id=user_id,
        sequence=0,
        lineage="",
        selections=enabled,
        api_key_values=api_key_values,
        provider_config_values=provider_config_values,
        enrollment_sync_status=enrollment_sync_status,
        gateway_virtual_keys=gateway_virtual_keys,
        gateway_base_url=settings.agent_gateway_litellm_public_base_url or None,
        harness_settings=harness_settings,
        seat_values=seat_values,
        gateway_budget_available=gateway_budget_available,
    )
