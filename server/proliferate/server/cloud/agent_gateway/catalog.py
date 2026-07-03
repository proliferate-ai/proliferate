"""Agent gateway model catalog: layered reads, refresh, user overrides.

Layering (spec §6): the served catalog is the latest active snapshot for
(harness, surface, route) — the caller's own snapshot when one exists,
otherwise the ownerless seed snapshot — with the caller's override patch
applied on top. Overrides are stored separately from snapshots, so a
refresh replaces the base while the override keeps applying.

Wire formats (JSON strings in the store):

- snapshot ``models_json``: array of model entries. Entries are objects
  with at least ``id``; bare strings normalize to ``{"id": <str>}``.
- override ``patch_json``: object with optional keys:
  ``remove`` (list of model ids), ``update`` (map of model id → partial
  entry merged onto the base), ``add`` (list of entries appended, or
  replacing a base entry with the same id). Applied in that order.

Refresh source per route:

- ``gateway``: server-side — list models from LiteLLM with the caller's
  virtual key and store the result as a ``probe`` snapshot.
- ``native`` / ``api_key``: probes run on the client runtime (Desktop /
  AnyHarness), so the client uploads the probe payload as ``models_json``.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.agent_gateway import (
    AGENT_AUTH_SOURCE_GATEWAY as AGENT_AUTH_ROUTE_GATEWAY,
)
from proliferate.constants.agent_gateway import (
    AGENT_HARNESS_KIND_MAX_LENGTH,
)
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store.agent_gateway import (
    AgentCatalogOverrideRecord,
    AgentCatalogSnapshotRecord,
)
from proliferate.integrations import litellm
from proliferate.integrations.litellm import LiteLLMIntegrationError
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import log_cloud_event

logger = logging.getLogger(__name__)

_MAX_MODELS_JSON_BYTES = 512 * 1024
_MAX_PATCH_JSON_BYTES = 64 * 1024
_HARNESS_KIND_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")


def validate_harness_kind(harness_kind: str) -> str:
    """Bound the harness_kind path/body param; raise a 400 (never a 500).

    harness_kind is a slug (route selections accept arbitrary kinds), but an
    empty or over-64-char value would blow past the String(64) column and 500
    on insert, and unbounded distinct values inflate snapshot cardinality.
    """
    if not harness_kind or len(harness_kind) > AGENT_HARNESS_KIND_MAX_LENGTH:
        raise CloudApiError(
            "invalid_agent_harness_kind",
            f"harness_kind must be 1-{AGENT_HARNESS_KIND_MAX_LENGTH} characters.",
            status_code=400,
        )
    if _HARNESS_KIND_PATTERN.match(harness_kind) is None:
        raise CloudApiError(
            "invalid_agent_harness_kind",
            "harness_kind may only contain letters, digits, '.', '_' or '-'.",
            status_code=400,
        )
    return harness_kind


def _normalize_entry(entry: object) -> dict[str, Any] | None:
    if isinstance(entry, str):
        return {"id": entry}
    if isinstance(entry, dict) and isinstance(entry.get("id"), str):
        return entry
    return None


def parse_models_json(models_json: str) -> list[dict[str, Any]]:
    """Parse and normalize a snapshot payload; raises ValueError when invalid."""
    try:
        payload = json.loads(models_json)
    except json.JSONDecodeError as error:
        raise ValueError("models_json must be valid JSON.") from error
    if not isinstance(payload, list):
        raise ValueError("models_json must be a JSON array of model entries.")
    models: list[dict[str, Any]] = []
    for entry in payload:
        normalized = _normalize_entry(entry)
        if normalized is None:
            raise ValueError("Each model entry must be a string id or an object with an id.")
        models.append(normalized)
    return models


def parse_patch_json(patch_json: str) -> dict[str, Any]:
    """Parse and shape-check an override patch; raises ValueError when invalid."""
    try:
        patch = json.loads(patch_json)
    except json.JSONDecodeError as error:
        raise ValueError("patch_json must be valid JSON.") from error
    if not isinstance(patch, dict):
        raise ValueError("patch_json must be a JSON object.")
    unknown = set(patch) - {"remove", "update", "add"}
    if unknown:
        raise ValueError(f"Unknown patch keys: {', '.join(sorted(unknown))}.")
    remove = patch.get("remove", [])
    if not isinstance(remove, list) or not all(isinstance(item, str) for item in remove):
        raise ValueError("patch remove must be a list of model ids.")
    update = patch.get("update", {})
    if not isinstance(update, dict) or not all(
        isinstance(value, dict) for value in update.values()
    ):
        raise ValueError("patch update must map model ids to partial entries.")
    add = patch.get("add", [])
    if not isinstance(add, list) or any(_normalize_entry(entry) is None for entry in add):
        raise ValueError("patch add entries must be string ids or objects with an id.")
    return patch


def apply_override(
    models: list[dict[str, Any]],
    patch: dict[str, Any],
) -> list[dict[str, Any]]:
    """Apply an override patch to base models: remove → update → add."""
    removed = set(patch.get("remove", []))
    updates: dict[str, dict[str, Any]] = patch.get("update", {})
    layered: list[dict[str, Any]] = []
    for entry in models:
        model_id = entry["id"]
        if model_id in removed:
            continue
        if model_id in updates:
            entry = {**entry, **updates[model_id], "id": model_id}
        layered.append(entry)
    seen = {entry["id"] for entry in layered}
    for raw in patch.get("add", []):
        added = _normalize_entry(raw)
        assert added is not None  # validated by parse_patch_json
        if added["id"] in seen:
            layered = [added if entry["id"] == added["id"] else entry for entry in layered]
        else:
            layered.append(added)
            seen.add(added["id"])
    return layered


async def _load_layered(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    surface: str,
    route: str,
) -> tuple[
    AgentCatalogSnapshotRecord | None,
    AgentCatalogOverrideRecord | None,
    list[dict[str, Any]],
]:
    snapshot = await agent_gateway_store.get_latest_catalog_snapshot(
        db,
        harness_kind=harness_kind,
        surface=surface,
        route=route,
        owner_user_id=user_id,
    )
    if snapshot is None:
        snapshot = await agent_gateway_store.get_latest_catalog_snapshot(
            db,
            harness_kind=harness_kind,
            surface=surface,
            route=route,
            owner_user_id=None,
        )
    models: list[dict[str, Any]] = []
    if snapshot is not None:
        try:
            models = parse_models_json(snapshot.models_json)
        except ValueError:
            # A single malformed stored row must not break the catalog for the
            # whole scope on read — skip it (treat as empty) and log for repair.
            logger.warning(
                "Skipping malformed agent catalog snapshot on read",
                extra={
                    "snapshot_id": str(snapshot.id),
                    "harness_kind": harness_kind,
                    "surface": surface,
                    "route": route,
                },
            )
            models = []
    override = await agent_gateway_store.get_catalog_override(
        db,
        harness_kind=harness_kind,
        owner_user_id=user_id,
    )
    if override is not None:
        models = apply_override(models, parse_patch_json(override.patch_json))
    return snapshot, override, models


async def get_catalog(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    surface: str,
    route: str,
) -> tuple[
    AgentCatalogSnapshotRecord | None,
    AgentCatalogOverrideRecord | None,
    list[dict[str, Any]],
]:
    """Return (base snapshot, override, layered models) for the caller."""
    validate_harness_kind(harness_kind)
    return await _load_layered(
        db,
        user_id=user_id,
        harness_kind=harness_kind,
        surface=surface,
        route=route,
    )


async def refresh_catalog(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    surface: str,
    route: str,
    models_json: str | None,
) -> tuple[
    AgentCatalogSnapshotRecord | None,
    AgentCatalogOverrideRecord | None,
    list[dict[str, Any]],
]:
    """Store a fresh owner-scoped probe snapshot and return the layered result."""
    validate_harness_kind(harness_kind)
    if route == AGENT_AUTH_ROUTE_GATEWAY:
        if models_json is not None:
            raise CloudApiError(
                "invalid_agent_catalog_refresh",
                "Gateway-route refreshes are server-side; do not upload models_json.",
                status_code=400,
            )
        stored_models_json = await _probe_gateway_models(db, user_id=user_id)
        if len(stored_models_json.encode()) > _MAX_MODELS_JSON_BYTES:
            raise CloudApiError(
                "invalid_agent_catalog_models",
                "The gateway returned a model list exceeding the maximum payload size.",
                status_code=502,
            )
    else:
        # Local/native probes execute on the client runtime; the client
        # uploads the resulting payload.
        if models_json is None:
            raise CloudApiError(
                "invalid_agent_catalog_refresh",
                f"A {route}-route refresh requires a client-probed models_json payload.",
                status_code=400,
            )
        if len(models_json.encode()) > _MAX_MODELS_JSON_BYTES:
            raise CloudApiError(
                "invalid_agent_catalog_models",
                "models_json exceeds the maximum payload size.",
                status_code=400,
            )
        try:
            parsed = parse_models_json(models_json)
        except ValueError as error:
            raise CloudApiError(
                "invalid_agent_catalog_models",
                str(error),
                status_code=400,
            ) from error
        stored_models_json = json.dumps(parsed)

    snapshot = await agent_gateway_store.create_catalog_snapshot(
        db,
        harness_kind=harness_kind,
        surface=surface,
        route=route,
        owner_user_id=user_id,
        models_json=stored_models_json,
        source="probe",
    )
    log_cloud_event(
        "agent_catalog_refreshed",
        user_id=str(user_id),
        harness_kind=harness_kind,
        surface=surface,
        route=route,
        snapshot_id=str(snapshot.id),
        model_count=len(parse_models_json(snapshot.models_json)),
    )
    return await _load_layered(
        db,
        user_id=user_id,
        harness_kind=harness_kind,
        surface=surface,
        route=route,
    )


async def _probe_gateway_models(db: AsyncSession, *, user_id: UUID) -> str:
    enrollment = await agent_gateway_store.get_enrollment_for_user(db, user_id=user_id)
    virtual_key: str | None = None
    if enrollment is not None:
        virtual_key = await agent_gateway_store.get_enrollment_virtual_key_decrypted(
            db,
            enrollment_id=enrollment.id,
        )
    if virtual_key is None:
        raise CloudApiError(
            "agent_gateway_enrollment_not_ready",
            "Gateway catalog refresh requires a synced enrollment with a virtual key.",
            status_code=409,
        )
    try:
        model_ids = await litellm.list_models(virtual_key=virtual_key)
    except LiteLLMIntegrationError as error:
        raise CloudApiError(
            "agent_gateway_upstream_error",
            "The LLM gateway could not list models.",
            status_code=502,
        ) from error
    return json.dumps([{"id": model_id} for model_id in sorted(set(model_ids))])


async def upsert_override(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    patch_json: str,
) -> AgentCatalogOverrideRecord:
    validate_harness_kind(harness_kind)
    if len(patch_json.encode()) > _MAX_PATCH_JSON_BYTES:
        raise CloudApiError(
            "invalid_agent_catalog_override",
            "patch_json exceeds the maximum payload size.",
            status_code=400,
        )
    try:
        patch = parse_patch_json(patch_json)
    except ValueError as error:
        raise CloudApiError(
            "invalid_agent_catalog_override",
            str(error),
            status_code=400,
        ) from error
    record = await agent_gateway_store.upsert_catalog_override(
        db,
        harness_kind=harness_kind,
        patch_json=json.dumps(patch),
        owner_user_id=user_id,
    )
    log_cloud_event(
        "agent_catalog_override_upserted",
        user_id=str(user_id),
        harness_kind=harness_kind,
        override_id=str(record.id),
    )
    return record


async def delete_override(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
) -> None:
    validate_harness_kind(harness_kind)
    deleted = await agent_gateway_store.delete_catalog_override(
        db,
        harness_kind=harness_kind,
        owner_user_id=user_id,
    )
    if not deleted:
        raise CloudApiError(
            "agent_catalog_override_not_found",
            "No catalog override exists for this harness.",
            status_code=404,
        )
    log_cloud_event(
        "agent_catalog_override_deleted",
        user_id=str(user_id),
        harness_kind=harness_kind,
    )
