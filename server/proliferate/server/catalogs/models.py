from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class AgentCatalogControlSurfaces(BaseModel):
    start: bool
    session: bool
    automation: bool
    settings: bool


class AgentCatalogControlApply(BaseModel):
    createField: Literal["modelId", "modeId"] | None = None
    liveConfigId: str | None = None
    liveSetter: Literal["runtime_control"] | None = None
    queueBeforeMaterialized: bool = False


class AgentCatalogControlValue(BaseModel):
    model_config = ConfigDict(extra="allow")

    value: str
    label: str
    description: str | None = None
    isDefault: bool = False
    status: Literal["active", "candidate", "deprecated", "hidden"] | None = None


class AgentCatalogControl(BaseModel):
    model_config = ConfigDict(extra="allow")

    key: str
    label: str
    description: str | None = None
    type: Literal["select"]
    category: str | None = None
    defaultValue: str | None
    surfaces: AgentCatalogControlSurfaces
    apply: AgentCatalogControlApply
    missingLiveConfigPolicy: Literal[
        "ignore_default",
        "queue_then_conflict",
        "block_prompt",
        "remediate",
    ]
    valueSource: Literal["inline", "agentModels", "discoveredModels"]
    values: list[AgentCatalogControlValue]
    queueWhileMaterializing: bool = False
    mutableAfterMaterialized: bool = True


class AgentCatalogLaunchRemediation(BaseModel):
    model_config = ConfigDict(extra="allow")

    kind: Literal["managed_reinstall", "external_update", "restart"]
    message: str


class AgentCatalogModel(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    displayName: str
    description: str | None = None
    aliases: list[str] = []
    status: Literal["active", "candidate", "deprecated", "hidden"]
    isDefault: bool
    provider: str | None = None
    tags: list[str] = []
    capabilities: dict[str, object] | None = None
    compatibility: dict[str, object] | None = None
    launchRemediation: AgentCatalogLaunchRemediation | None = None


class AgentCatalogModelDisplayPolicy(BaseModel):
    defaultVisibleModelIds: list[str]
    allowUserVisibleModelSelection: bool
    moreModelsSource: Literal["none", "lastKnownLiveSnapshot", "liveSnapshotOnly"] | None = None


class AgentCatalogPromptCapabilities(BaseModel):
    image: bool
    audio: bool
    embeddedContext: bool


class AgentCatalogSession(BaseModel):
    model_config = ConfigDict(extra="allow")

    defaultModelId: str
    defaultModeId: str | None = None
    dynamicModels: bool = False
    modelDisplayPolicy: AgentCatalogModelDisplayPolicy | None = None
    promptCapabilities: AgentCatalogPromptCapabilities | None = None
    compatibility: dict[str, object] | None = None
    models: list[AgentCatalogModel]
    controls: list[AgentCatalogControl]


class AgentCatalogAgent(BaseModel):
    kind: Literal["claude", "codex", "gemini", "cursor", "opencode"]
    displayName: str
    description: str | None = None
    process: dict[str, object]
    session: AgentCatalogSession


class AgentCatalogResponse(BaseModel):
    schemaVersion: Literal[1]
    catalogVersion: str
    generatedAt: str
    compatibility: dict[str, object] | None = None
    agents: list[AgentCatalogAgent]
