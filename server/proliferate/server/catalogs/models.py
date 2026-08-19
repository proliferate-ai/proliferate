from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class CatalogModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AgentCatalogProbedAgainst(CatalogModel):
    registryVersion: str | None = None


class AgentCatalogArtifactPin(CatalogModel):
    # Source varies by install mechanism and is distribution-only.
    model_config = ConfigDict(extra="allow")

    version: str
    sha256: str | None = None


class AgentCatalogDataPin(CatalogModel):
    model_config = ConfigDict(extra="allow")

    id: str | None = None
    snapshotPath: str | None = None
    sha256: str | None = None


class AgentCatalogHarnessPins(CatalogModel):
    agentProcess: AgentCatalogArtifactPin
    native: AgentCatalogArtifactPin | None = None
    data: AgentCatalogDataPin | None = None


class AgentCatalogAuthContext(CatalogModel):
    id: str
    authSlotId: str | None = None
    description: str | None = None
    signals: dict[str, object] | None = None


class AgentCatalogPresentationModel(CatalogModel):
    """Display-only metadata joined by exact observed model id."""

    id: str
    displayName: str
    description: str | None = None


class AgentCatalogSession(CatalogModel):
    supportsGoals: bool = False
    presentationModels: list[AgentCatalogPresentationModel] = []


class AgentCatalogAttestation(CatalogModel):
    name: str
    version: str
    title: str | None = None


class AgentCatalogProbeRun(CatalogModel):
    id: str
    snapshotPath: str | None = None


class AgentCatalogAgentProvenance(CatalogModel):
    probedAt: str
    attestation: AgentCatalogAttestation | None = None
    runs: list[AgentCatalogProbeRun] = []


class AgentCatalogAgent(CatalogModel):
    kind: Literal["claude", "codex", "cursor", "opencode", "grok"]
    displayName: str
    harness: AgentCatalogHarnessPins
    authContexts: list[AgentCatalogAuthContext] = []
    session: AgentCatalogSession
    provenance: AgentCatalogAgentProvenance


class AgentCatalogResponse(CatalogModel):
    schemaVersion: Literal[2]
    catalogVersion: str
    probedAgainst: AgentCatalogProbedAgainst | None = None
    generatedAt: str
    agents: list[AgentCatalogAgent]
