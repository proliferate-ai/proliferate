export type DesktopAgentCatalogStatus = "candidate" | "active" | "deprecated" | "hidden";

export type DesktopAgentLaunchRemediationKind =
  | "managed_reinstall"
  | "external_update"
  | "restart";

export interface DesktopAgentLaunchRemediation {
  kind: DesktopAgentLaunchRemediationKind;
  message: string;
}

export interface DesktopAgentLaunchControlSurfaces {
  start: boolean;
  session: boolean;
  automation: boolean;
  settings: boolean;
}

export interface DesktopAgentLaunchControlApply {
  createField?: "modelId" | "modeId" | null;
  liveConfigId?: string | null;
  liveSetter?: "runtime_control" | null;
  queueBeforeMaterialized: boolean;
}

export interface DesktopAgentLaunchControlValue {
  value: string;
  label: string;
  description?: string | null;
  isDefault: boolean;
  status?: DesktopAgentCatalogStatus | null;
}

export type DesktopAgentLaunchControlPhase = "create_session" | "live_default";

export interface DesktopAgentLaunchControl {
  key: string;
  label: string;
  description?: string | null;
  type: "select";
  category?: string | null;
  defaultValue: string | null;
  createField?: "modelId" | "modeId" | null;
  phase: DesktopAgentLaunchControlPhase;
  surfaces: DesktopAgentLaunchControlSurfaces;
  apply: DesktopAgentLaunchControlApply;
  missingLiveConfigPolicy:
    | "ignore_default"
    | "queue_then_conflict"
    | "block_prompt"
    | "remediate";
  valueSource: "inline" | "agentModels" | "discoveredModels";
  values: DesktopAgentLaunchControlValue[];
  queueWhileMaterializing: boolean;
  mutableAfterMaterialized: boolean;
}

export interface DesktopSessionDefaultControlValue {
  value: string;
  label: string;
  description?: string | null;
  isDefault: boolean;
}

export interface DesktopSessionDefaultControl {
  key: "reasoning" | "effort" | "fast_mode";
  label: string;
  defaultValue?: string | null;
  values: DesktopSessionDefaultControlValue[];
}

export interface DesktopLaunchModelRegistryModel {
  id: string;
  displayName: string;
  description?: string | null;
  aliases?: string[];
  status?: DesktopAgentCatalogStatus;
  isDefault: boolean;
  defaultOptIn?: boolean | null;
  launchRemediation?: DesktopAgentLaunchRemediation | null;
  sessionDefaultControls?: DesktopSessionDefaultControl[];
}

export interface DesktopAgentLaunchModel extends DesktopLaunchModelRegistryModel {
  aliases: string[];
  status: DesktopAgentCatalogStatus;
  provider?: string | null;
  tags: string[];
}

export interface DesktopAgentModelDisplayPolicy {
  defaultVisibleModelIds: string[];
  allowUserVisibleModelSelection: boolean;
  moreModelsSource?: "none" | "lastKnownLiveSnapshot" | "liveSnapshotOnly" | null;
}

export interface DesktopAgentPromptCapabilities {
  image: boolean;
  audio: boolean;
  embeddedContext: boolean;
}

export interface DesktopAgentLaunchAgent {
  kind: string;
  displayName: string;
  description?: string | null;
  defaultModelId: string | null;
  defaultModeId?: string | null;
  dynamicModels: boolean;
  modelDisplayPolicy?: DesktopAgentModelDisplayPolicy | null;
  promptCapabilities?: DesktopAgentPromptCapabilities | null;
  models: DesktopAgentLaunchModel[];
  launchControls: DesktopAgentLaunchControl[];
}

export interface DesktopAgentLaunchCatalog {
  schemaVersion: 1;
  catalogVersion: string;
  generatedAt: string;
  workspaceId: string | null;
  agents: DesktopAgentLaunchAgent[];
}

export interface DesktopLaunchModelRegistry {
  kind: string;
  displayName: string;
  defaultModelId?: string | null;
  models: DesktopLaunchModelRegistryModel[];
}

export interface RuntimeAgentLaunchOptions {
  kind: string;
  displayName: string;
  defaultModelId?: string | null;
  models: Array<{
    id: string;
    displayName: string;
    aliases?: string[];
    isDefault: boolean;
    defaultOptIn?: boolean | null;
  }>;
}

export interface CloudAgentCatalogResponseInput {
  schemaVersion: 1;
  catalogVersion: string;
  generatedAt: string;
  compatibility?: Record<string, unknown> | null;
  agents: CloudAgentCatalogAgentInput[];
}

export interface CloudAgentCatalogAgentInput {
  kind: string;
  displayName: string;
  description?: string | null;
  session: CloudAgentCatalogSessionInput;
}

export interface CloudAgentCatalogSessionInput {
  defaultModelId: string;
  defaultModeId?: string | null;
  dynamicModels: boolean;
  modelDisplayPolicy?: DesktopAgentModelDisplayPolicy | null;
  promptCapabilities?: DesktopAgentPromptCapabilities | null;
  compatibility?: Record<string, unknown> | null;
  models: CloudAgentCatalogModelInput[];
  controls: CloudAgentCatalogControlInput[];
}

export interface CloudAgentCatalogModelInput {
  id: string;
  displayName: string;
  description?: string | null;
  aliases?: string[];
  status: DesktopAgentCatalogStatus;
  isDefault: boolean;
  defaultOptIn?: boolean | null;
  provider?: string | null;
  tags?: string[];
  capabilities?: Record<string, unknown> | null;
  compatibility?: Record<string, unknown> | null;
  launchRemediation?: DesktopAgentLaunchRemediation | null;
}

export interface CloudAgentCatalogControlInput {
  key: string;
  label: string;
  description?: string | null;
  type: "select";
  category?: string | null;
  defaultValue: string | null;
  surfaces: DesktopAgentLaunchControlSurfaces;
  apply: DesktopAgentLaunchControlApply;
  missingLiveConfigPolicy: DesktopAgentLaunchControl["missingLiveConfigPolicy"];
  valueSource: DesktopAgentLaunchControl["valueSource"];
  values: CloudAgentCatalogControlValueInput[];
  queueWhileMaterializing: boolean;
  mutableAfterMaterialized: boolean;
}

export interface CloudAgentCatalogControlValueInput {
  value: string;
  label: string;
  description?: string | null;
  isDefault: boolean;
  status?: DesktopAgentCatalogStatus | null;
}

export interface ProjectCloudAgentCatalogOptions {
  workspaceId?: string | null;
}
