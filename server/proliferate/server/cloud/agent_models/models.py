"""Wire models for the cloud model-snapshot routes (camelCase aliases).

Snapshot identity on the wire matches the table (model-catalog.md §Cloud
routes): harness, auth context id, ``probedAt``. There is no ``surface`` and no
``source``: the store holds cloud-sandbox observations only, and every row is a
machine's observation, so the only tier distinction a client needs is whether
the base came from an observation or the shipped seed — which ``origin`` carries.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from proliferate.db.store.agent_gateway import (
    AgentCatalogOverrideRecord,
    AgentModelSnapshotRecord,
)
from proliferate.server.cloud.agent_models.snapshots import LayeredModels, ModelOrigin


class AgentModelsBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class AgentModelsResponse(AgentModelsBaseModel):
    """The layered read: owner's snapshot else shipped seed, + caller override."""

    harness_kind: str = Field(alias="harnessKind")
    auth_context_id: str = Field(alias="authContextId")
    models: list[dict[str, Any]]
    modes: list[dict[str, Any]]
    #: ``snapshot`` when a machine observed this context; ``catalog`` when the
    #: shipped list is filling the absence (unverified seed data).
    origin: ModelOrigin
    snapshot_id: str | None = Field(alias="snapshotId")
    probed_at: str | None = Field(alias="probedAt")
    override_applied: bool = Field(alias="overrideApplied")


class AgentModelSnapshotIngestRequest(AgentModelsBaseModel):
    """A Worker's upload of one changed machine-document entry.

    Deliberately carries no user identity: the server resolves the owner from
    the Worker's sandbox row. ``snapshotJson`` is one document entry verbatim
    (camelCase ``probedAt``/``models``/``modes``/``attestation``/``warnings``),
    stored as-is so the cloud tier serves exactly what the machine observed.
    """

    auth_context_id: str = Field(alias="authContextId")
    snapshot_json: str = Field(alias="snapshotJson")
    probed_at: str = Field(alias="probedAt")


class AgentModelOverrideUpsertRequest(AgentModelsBaseModel):
    patch_json: str = Field(alias="patchJson")


class AgentModelOverrideResponse(AgentModelsBaseModel):
    id: str
    harness_kind: str = Field(alias="harnessKind")
    patch_json: str = Field(alias="patchJson")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


def models_payload(
    *,
    harness_kind: str,
    auth_context_id: str,
    layered: LayeredModels,
) -> AgentModelsResponse:
    snapshot: AgentModelSnapshotRecord | None = layered.snapshot
    return AgentModelsResponse(
        harness_kind=harness_kind,
        auth_context_id=auth_context_id,
        models=layered.models,
        modes=layered.modes,
        origin=layered.origin,
        snapshot_id=str(snapshot.id) if snapshot is not None else None,
        probed_at=snapshot.probed_at.isoformat() if snapshot is not None else None,
        override_applied=layered.override is not None,
    )


def override_payload(record: AgentCatalogOverrideRecord) -> AgentModelOverrideResponse:
    return AgentModelOverrideResponse(
        id=str(record.id),
        harness_kind=record.harness_kind,
        patch_json=record.patch_json,
        created_at=record.created_at.isoformat(),
        updated_at=record.updated_at.isoformat(),
    )
