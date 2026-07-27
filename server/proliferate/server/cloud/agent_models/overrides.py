"""Override patch parse + remove→update→add apply, and the shared id bounds.

Contract unchanged by the snapshot re-key (model-catalog.md §Storage): the
override table holds one ``patch_json`` per (user, harness) with optional
``remove`` (model ids), ``update`` (id → partial entry), and ``add`` (entries),
applied in that order on every layered read.
"""

from __future__ import annotations

import json
import re
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.agent_gateway import (
    AGENT_AUTH_CONTEXT_ID_MAX_LENGTH,
    AGENT_HARNESS_KIND_MAX_LENGTH,
)
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store.agent_gateway import AgentCatalogOverrideRecord
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import log_cloud_event

MAX_PATCH_JSON_BYTES = 64 * 1024
_SLUG_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")


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
    if _SLUG_PATTERN.match(harness_kind) is None:
        raise CloudApiError(
            "invalid_agent_harness_kind",
            "harness_kind may only contain letters, digits, '.', '_' or '-'.",
            status_code=400,
        )
    return harness_kind


def validate_auth_context_id(auth_context_id: str) -> str:
    """Bound the auth-context id for the same column/cardinality reasons.

    Deliberately not checked against the shipped catalog: a machine whose
    harness catalog is newer than this server's document must still be able to
    upload its observation, and the read-side join tolerates unknown contexts.
    """
    if not auth_context_id or len(auth_context_id) > AGENT_AUTH_CONTEXT_ID_MAX_LENGTH:
        raise CloudApiError(
            "invalid_agent_auth_context_id",
            f"authContextId must be 1-{AGENT_AUTH_CONTEXT_ID_MAX_LENGTH} characters.",
            status_code=400,
        )
    if _SLUG_PATTERN.match(auth_context_id) is None:
        raise CloudApiError(
            "invalid_agent_auth_context_id",
            "authContextId may only contain letters, digits, '.', '_' or '-'.",
            status_code=400,
        )
    return auth_context_id


def normalize_entry(entry: object) -> dict[str, Any] | None:
    if isinstance(entry, str):
        return {"id": entry}
    if isinstance(entry, dict) and isinstance(entry.get("id"), str):
        return entry
    return None


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
    if not isinstance(add, list) or any(normalize_entry(entry) is None for entry in add):
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
        added = normalize_entry(raw)
        assert added is not None  # validated by parse_patch_json
        if added["id"] in seen:
            layered = [added if entry["id"] == added["id"] else entry for entry in layered]
        else:
            layered.append(added)
            seen.add(added["id"])
    return layered


async def upsert_override(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    patch_json: str,
) -> AgentCatalogOverrideRecord:
    validate_harness_kind(harness_kind)
    if len(patch_json.encode()) > MAX_PATCH_JSON_BYTES:
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
