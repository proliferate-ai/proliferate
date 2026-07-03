from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class AgentCatalogProbedAgainst(BaseModel):
    """Pairing with the registry document the probe ran against."""

    registryVersion: str | None = None


class AgentCatalogArtifactPin(BaseModel):
    model_config = ConfigDict(extra="allow")

    version: str
    sha256: str | None = None


class AgentCatalogDataPin(BaseModel):
    """Pinned data dependency that gates model lists (e.g. opencode models.dev)."""

    model_config = ConfigDict(extra="allow")

    id: str | None = None
    snapshotPath: str | None = None
    sha256: str | None = None


class AgentCatalogHarnessPins(BaseModel):
    """The pin block: exact versions the probe validated."""

    model_config = ConfigDict(extra="allow")

    agentProcess: AgentCatalogArtifactPin
    native: AgentCatalogArtifactPin | None = None
    data: AgentCatalogDataPin | None = None


class AgentCatalogAuthContext(BaseModel):
    """Ordered auth context; ``"baseline"`` is reserved and carries no auth slot.

    ``signals`` is the externally tagged detection-signature algebra
    (``env | envFlag | discovery | anyOf | allOf``); served opaquely.
    """

    model_config = ConfigDict(extra="allow")

    id: str
    authSlotId: str | None = None
    description: str | None = None
    signals: dict[str, object] | None = None


class AgentCatalogControlMapping(BaseModel):
    model_config = ConfigDict(extra="allow")

    createField: str | None = None
    liveConfigId: str | None = None
    switchVia: Literal["setSessionModel", "configOption"] | None = None
    variantSyntax: str | None = None
    missingLiveConfigPolicy: str | None = None


class AgentCatalogSessionControl(BaseModel):
    """One key of the control universe; per-model matrices are subsets of this."""

    model_config = ConfigDict(extra="allow")

    key: str
    label: str | None = None
    values: list[str] = []
    mapping: AgentCatalogControlMapping | None = None


class AgentCatalogAvailability(BaseModel):
    """Observed-set availability: the auth contexts whose probe runs contained the model."""

    anyOf: list[str]


class AgentCatalogModelControl(BaseModel):
    """Per-model option matrix entry: exactly the values this model supports."""

    model_config = ConfigDict(extra="allow")

    values: list[str]
    default: str | None = None
    observedValue: str | None = None


class AgentCatalogModelProvenance(BaseModel):
    model_config = ConfigDict(extra="allow")

    observedIn: list[str] = []
    observedInAllContexts: bool | None = None
    viaTrialOnly: bool | None = None
    variantIds: list[str] = []


class AgentCatalogModel(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    displayName: str
    description: str | None = None
    aliases: list[str] = []
    family: str | None = None
    availability: AgentCatalogAvailability
    defaultVisible: bool = False
    controls: dict[str, AgentCatalogModelControl] = {}
    status: Literal["active", "candidate", "deprecated", "hidden"]
    provenance: AgentCatalogModelProvenance | None = None


class AgentCatalogSession(BaseModel):
    model_config = ConfigDict(extra="allow")

    controls: list[AgentCatalogSessionControl] = []
    models: list[AgentCatalogModel] = []
    defaults: dict[str, str] = {}
    observedDefaults: dict[str, str] = {}


class AgentCatalogAttestation(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    version: str
    title: str | None = None


class AgentCatalogProbeRun(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    snapshotPath: str | None = None


class AgentCatalogAgentProvenance(BaseModel):
    model_config = ConfigDict(extra="allow")

    probedAt: str
    attestation: AgentCatalogAttestation | None = None
    runs: list[AgentCatalogProbeRun] = []


class AgentCatalogAgent(BaseModel):
    kind: Literal["claude", "codex", "cursor", "opencode", "grok"]
    displayName: str
    harness: AgentCatalogHarnessPins
    authContexts: list[AgentCatalogAuthContext] = []
    session: AgentCatalogSession
    provenance: AgentCatalogAgentProvenance


class AgentCatalogResponse(BaseModel):
    schemaVersion: Literal[2]
    catalogVersion: str
    probedAgainst: AgentCatalogProbedAgainst | None = None
    generatedAt: str
    agents: list[AgentCatalogAgent]
