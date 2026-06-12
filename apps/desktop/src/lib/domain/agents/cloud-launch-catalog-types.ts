import type { ModelAvailability } from "./model-availability";

export type DesktopAgentCatalogStatus = "candidate" | "active" | "deprecated" | "hidden";

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
  /** v2 availability gate (`anyOf` auth context ids); null when unknown. */
  availability?: ModelAvailability | null;
  sessionDefaultControls?: DesktopSessionDefaultControl[];
}

export interface DesktopAgentLaunchModel extends DesktopLaunchModelRegistryModel {
  aliases: string[];
  status: DesktopAgentCatalogStatus;
}

export interface DesktopAgentLaunchAgent {
  kind: string;
  displayName: string;
  description?: string | null;
  defaultModelId: string | null;
  models: DesktopAgentLaunchModel[];
  launchControls: DesktopAgentLaunchControl[];
}

export interface DesktopAgentLaunchCatalog {
  schemaVersion: 2;
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

/**
 * The raw schemaVersion-2 agent catalog document
 * (`catalogs/agents/catalog.json`, also served by the cloud catalog
 * endpoint). Mirrors the runtime read surface in
 * `anyharness-lib/src/domains/agents/catalog/schema.rs`.
 */
export interface CloudAgentCatalogResponseInput {
  schemaVersion: 2;
  catalogVersion: string;
  generatedAt: string;
  probedAgainst?: Record<string, unknown> | null;
  agents: CloudAgentCatalogAgentInput[];
}

export interface CloudAgentCatalogAgentInput {
  kind: string;
  displayName: string;
  description?: string | null;
  harness?: Record<string, unknown> | null;
  authContexts?: CloudAgentCatalogAuthContextInput[];
  session: CloudAgentCatalogSessionInput;
  provenance?: Record<string, unknown> | null;
}

export interface CloudAgentCatalogAuthContextInput {
  id: string;
  authSlotId?: string | null;
  description?: string | null;
  signals?: unknown;
}

export interface CloudAgentCatalogSessionInput {
  controls?: CloudAgentCatalogControlInput[];
  models: CloudAgentCatalogModelInput[];
  /** Curation default per auth context id (contextId -> modelId). */
  defaults?: Record<string, string> | null;
  observedDefaults?: Record<string, string> | null;
}

export interface CloudAgentCatalogControlMappingInput {
  createField?: "modelId" | "modeId" | null;
  switchVia?: string | null;
  liveConfigId?: string | null;
  variantSyntax?: string | null;
}

export interface CloudAgentCatalogControlInput {
  key: string;
  label?: string | null;
  values?: string[];
  mapping?: CloudAgentCatalogControlMappingInput | null;
}

export interface CloudAgentCatalogModelControlInput {
  values?: string[];
  default?: string | null;
  observedValue?: string | null;
}

export interface CloudAgentCatalogModelInput {
  id: string;
  displayName: string;
  description?: string | null;
  aliases?: string[];
  family?: string | null;
  availability?: { anyOf?: string[] } | null;
  defaultVisible?: boolean;
  controls?: Record<string, CloudAgentCatalogModelControlInput> | null;
  status?: DesktopAgentCatalogStatus;
  provenance?: Record<string, unknown> | null;
}

export interface ProjectCloudAgentCatalogOptions {
  workspaceId?: string | null;
}
