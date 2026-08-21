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
  /**
   * Explicit provider namespace (model-catalog.md "Provider badges" —
   * every served model entry carries its origin as an explicit field, not
   * inferred from the id/displayName). `null`/absent when the source has no
   * provider classification for this model (e.g. an unmatched probe-only id).
   */
  provider?: string | null;
  aliases?: string[];
  status?: DesktopAgentCatalogStatus;
  isDefault: boolean;
  sessionDefaultControls?: DesktopSessionDefaultControl[];
  /**
   * Exact target-observed launch controls for this model. `null` means the
   * target did not report a model scope, so consumers use the compatible
   * harness-level statement. An empty array is authoritative.
   */
  launchControls?: DesktopAgentLaunchControl[] | null;
  /**
   * The `mode` control vocabulary this model actually supports (per-model
   * `controls.mode.values` in the catalog). Differs from the agent-level `mode`
   * control: e.g. gateway/bedrock Claude models exclude `auto`. `null` when the
   * model carries no per-model mode vocabulary (fall back to the agent-level
   * control). Used to keep the composer from offering/defaulting to a mode the
   * selected model would reject at session creation.
   */
  modeValues?: string[] | null;
  /**
   * Per-model tuning-control vocabulary from the catalog matrix, keyed by
   * desktop control key (`reasoning_effort` folds into `effort`). Unlike
   * `sessionDefaultControls` this does NOT fall back to the agent-level
   * vocabulary: a key absent here is a control the model does not support
   * (e.g. sonnet carries no `fast_mode`, gpt-5.5 caps effort at `xhigh`).
   * `null` when the model has no per-model controls matrix at all, in which
   * case the agent-level launch controls apply unscoped.
   */
  tuningControlValues?: DesktopModelTuningControlValues | null;
}

export type DesktopModelTuningControlValues = Partial<
  Record<"reasoning" | "effort" | "fast_mode", string[]>
>;

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
  defaultAgentKind: string | null;
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
    modes?: string[] | null;
    /** Runtime-resolved provider namespace (`AgentLaunchModelOption.provider`); already joined server-side. */
    provider?: string | null;
  }>;
}
