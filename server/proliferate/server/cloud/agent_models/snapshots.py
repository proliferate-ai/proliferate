"""Layered read + the single machine-snapshot ingest route.

Layering (model-catalog.md §Serving): the served model list for a
(user, harness) is the owner's latest active snapshot, else the **shipped
catalog's** models for the harness as a read-time seed, with the caller's
override patch applied on top. One composed observation per harness — there is
no ``auth_context_id`` anywhere on this surface; the per-context re-key is
superseded.

The seed is a read-time join, not stored state: there are no ownerless seed rows
to write or maintain, and the fallback goes straight to the catalog document the
server already serves at ``GET /v1/catalogs/agents``.

Ingest is one path — a Worker upload of the whole schemaVersion-2 machine
document (``snapshotJson`` + ``probedAt``), stored verbatim. The server never
generates snapshots: it cannot spawn a harness, so it cannot produce an
observation in the document shape.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.agent_gateway import AGENT_MODEL_SNAPSHOT_SCHEMA_VERSION
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store import cloud_sandboxes as cloud_sandboxes_store
from proliferate.db.store.agent_gateway import (
    AgentCatalogOverrideRecord,
    AgentModelSnapshotRecord,
)
from proliferate.server.catalogs.domain.selection import catalog_agent
from proliferate.server.catalogs.service import read_agent_catalog
from proliferate.server.cloud.agent_models.overrides import (
    apply_override,
    normalize_entry,
    parse_patch_json,
    validate_harness_kind,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import log_cloud_event

logger = logging.getLogger(__name__)

MAX_SNAPSHOT_JSON_BYTES = 512 * 1024

#: The read-time seed marker on the response. ``"snapshot"`` means a machine
#: observed it; ``"catalog"`` means no observation exists yet for this
#: (owner, harness) and the shipped list is filling the absence.
ModelOrigin = Literal["snapshot", "catalog"]

MODEL_ORIGIN_SNAPSHOT: ModelOrigin = "snapshot"
MODEL_ORIGIN_CATALOG: ModelOrigin = "catalog"


@dataclass(frozen=True)
class LayeredModels:
    """What a layered read resolved to, and which tier supplied the base."""

    models: list[dict[str, Any]]
    origin: ModelOrigin
    snapshot: AgentModelSnapshotRecord | None
    override: AgentCatalogOverrideRecord | None
    modes: list[dict[str, Any]]


def parse_snapshot_document(snapshot_json: str) -> dict[str, Any]:
    """Parse one machine document; raises ValueError when invalid.

    The document is accepted as the runtime writes it (camelCase, per
    model-catalog.md §Wire schema) and stored verbatim. Only the fields the
    server actually serves are shape-checked — ``models`` and ``modes`` — so a
    runtime that adds a diagnostic field is never rejected by an older server.
    ``schemaVersion`` is enforced at ingest (:func:`ingest_snapshot`), not
    here: stored rows were validated on the way in, and re-checking on read
    would turn one historic row into a permanent read failure.
    """
    try:
        payload = json.loads(snapshot_json)
    except json.JSONDecodeError as error:
        raise ValueError("snapshotJson must be valid JSON.") from error
    if not isinstance(payload, dict):
        raise ValueError("snapshotJson must be a JSON object (one machine document).")

    raw_models = payload.get("models", [])
    if not isinstance(raw_models, list):
        raise ValueError("snapshotJson.models must be an array of model entries.")
    models: list[dict[str, Any]] = []
    for entry in raw_models:
        normalized = normalize_entry(entry)
        if normalized is None:
            raise ValueError("Each model entry must be a string id or an object with an id.")
        models.append(normalized)

    raw_modes = payload.get("modes", [])
    if not isinstance(raw_modes, list):
        raise ValueError("snapshotJson.modes must be an array of mode entries.")
    modes: list[dict[str, Any]] = []
    for entry in raw_modes:
        normalized = normalize_entry(entry)
        if normalized is None:
            raise ValueError("Each mode entry must be a string id or an object with an id.")
        modes.append(normalized)

    return {**payload, "models": models, "modes": modes}


def _document_lists(snapshot_json: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    document = parse_snapshot_document(snapshot_json)
    return document["models"], document["modes"]


def shipped_models(harness_kind: str) -> list[dict[str, Any]]:
    """The shipped catalog's models for a harness — the read-time seed tier.

    The whole curated list, not a context-scoped slice: the observation is one
    composed document per harness (model-catalog.md §Serving), so the seed that
    fills its absence is the harness's model list with no per-context filter —
    there are no contexts to filter by.
    """
    agent = catalog_agent(read_agent_catalog().catalog, harness_kind)
    if agent is None:
        return []
    return [
        {
            "id": model.id,
            "displayName": model.displayName,
            "description": model.description,
            "aliases": list(model.aliases),
            "defaultVisible": model.defaultVisible,
            "status": model.status,
        }
        for model in agent.session.models
    ]


def shipped_modes(harness_kind: str) -> list[dict[str, Any]]:
    """The shipped catalog's mode ids — modes are harness-wide."""
    agent = catalog_agent(read_agent_catalog().catalog, harness_kind)
    if agent is None:
        return []
    control = next(
        (control for control in agent.session.controls if control.key == "mode"),
        None,
    )
    if control is None:
        return []
    return [{"id": value} for value in control.values]


async def _load_layered(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
) -> LayeredModels:
    snapshot = await agent_gateway_store.get_active_model_snapshot(
        db,
        harness_kind=harness_kind,
        owner_user_id=user_id,
    )

    models: list[dict[str, Any]] = []
    modes: list[dict[str, Any]] = []
    origin: ModelOrigin = MODEL_ORIGIN_CATALOG
    if snapshot is not None:
        try:
            models, modes = _document_lists(snapshot.snapshot_json)
            origin = MODEL_ORIGIN_SNAPSHOT
        except ValueError:
            # A single malformed stored row must not break the catalog for the
            # whole scope on read. Fall through to the shipped seed — which is
            # strictly better than the empty list this used to serve, and is the
            # same tier a user with no observation gets.
            logger.warning(
                "Skipping malformed agent model snapshot on read",
                extra={
                    "snapshot_id": str(snapshot.id),
                    "harness_kind": harness_kind,
                },
            )
            snapshot = None

    if origin == MODEL_ORIGIN_CATALOG:
        models = shipped_models(harness_kind)
        modes = shipped_modes(harness_kind)
    elif not modes:
        # Modes are baked into the binary, so a document that observed none
        # still renders the catalog's set rather than an empty mode picker.
        modes = shipped_modes(harness_kind)

    override = await agent_gateway_store.get_catalog_override(
        db,
        harness_kind=harness_kind,
        owner_user_id=user_id,
    )
    if override is not None:
        models = apply_override(models, parse_patch_json(override.patch_json))

    return LayeredModels(
        models=models,
        origin=origin,
        snapshot=snapshot,
        override=override,
        modes=modes,
    )


async def get_models(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
) -> LayeredModels:
    """The layered read for one (user, harness)."""
    validate_harness_kind(harness_kind)
    return await _load_layered(db, user_id=user_id, harness_kind=harness_kind)


async def resolve_upload_owner(
    db: AsyncSession,
    *,
    runtime_kind: str,
    cloud_sandbox_id: UUID | None,
) -> UUID:
    """Derive the snapshot owner from the uploading Worker's sandbox row.

    The owner is read off the ``cloud_sandbox`` row, never off the request body
    or even the worker row's own ``owner_user_id``: the sandbox is the machine
    whose document this is, and going through it means a re-owned or destroyed
    sandbox can never have a snapshot attributed to it.

    Desktop workers are refused (403 rather than 400): "the desktop's document
    never syncs" is a law of the design, not a malformed request — every
    machineless consumer picks models for cloud execution, so a local
    observation would be machinery without a reader (model-catalog.md §The
    cloud copy).
    """
    if runtime_kind != "cloud_sandbox" or cloud_sandbox_id is None:
        raise CloudApiError(
            "agent_model_snapshot_upload_forbidden",
            "Only a cloud-sandbox worker may upload model snapshots.",
            status_code=403,
        )
    sandbox = await cloud_sandboxes_store.load_cloud_sandbox_by_id(db, cloud_sandbox_id)
    if sandbox is None or sandbox.owner_user_id is None or sandbox.destroyed_at is not None:
        raise CloudApiError(
            "agent_model_snapshot_upload_forbidden",
            "The uploading worker's sandbox no longer resolves to an owner.",
            status_code=403,
        )
    return sandbox.owner_user_id


async def ingest_snapshot(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    harness_kind: str,
    snapshot_json: str,
    probed_at: str,
) -> LayeredModels:
    """Store a Worker-uploaded machine document and return the layered result.

    ``owner_user_id`` comes from :func:`resolve_upload_owner`, never from the
    request body: the payload carries no user identity, so a compromised Worker
    token can only write its own sandbox owner's snapshots.
    """
    validate_harness_kind(harness_kind)
    if len(snapshot_json.encode()) > MAX_SNAPSHOT_JSON_BYTES:
        raise CloudApiError(
            "invalid_agent_model_snapshot",
            "snapshotJson exceeds the maximum payload size.",
            status_code=400,
        )
    try:
        document = parse_snapshot_document(snapshot_json)
    except ValueError as error:
        raise CloudApiError(
            "invalid_agent_model_snapshot",
            str(error),
            status_code=400,
        ) from error
    if document.get("schemaVersion") != AGENT_MODEL_SNAPSHOT_SCHEMA_VERSION:
        # The composed-observation cutover is a hard cutover with no alias
        # window (model-catalog.md §API surface): a v1 per-context entry (or a
        # document that does not say what it is) is refused, never reinterpreted
        # as a composed observation.
        raise CloudApiError(
            "invalid_agent_model_snapshot",
            f"snapshotJson.schemaVersion must be {AGENT_MODEL_SNAPSHOT_SCHEMA_VERSION}.",
            status_code=400,
        )
    try:
        probed_at_value = datetime.fromisoformat(probed_at)
    except ValueError as error:
        raise CloudApiError(
            "invalid_agent_model_snapshot",
            "probedAt must be an ISO 8601 timestamp.",
            status_code=400,
        ) from error

    snapshot = await agent_gateway_store.create_model_snapshot(
        db,
        harness_kind=harness_kind,
        owner_user_id=owner_user_id,
        snapshot_json=json.dumps(document),
        probed_at=probed_at_value,
    )
    log_cloud_event(
        "agent_model_snapshot_ingested",
        user_id=str(owner_user_id),
        harness_kind=harness_kind,
        snapshot_id=str(snapshot.id),
        model_count=len(document["models"]),
    )
    return await _load_layered(db, user_id=owner_user_id, harness_kind=harness_kind)
