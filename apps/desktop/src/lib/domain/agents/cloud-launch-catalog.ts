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

interface CloudAgentCatalogResponseInput {
  schemaVersion: 1;
  catalogVersion: string;
  generatedAt: string;
  compatibility?: Record<string, unknown> | null;
  agents: CloudAgentCatalogAgentInput[];
}

interface CloudAgentCatalogAgentInput {
  kind: string;
  displayName: string;
  description?: string | null;
  process?: Record<string, unknown> | null;
  session: CloudAgentCatalogSessionInput;
}

interface CloudAgentCatalogSessionInput {
  defaultModelId: string;
  defaultModeId?: string | null;
  dynamicModels: boolean;
  modelDisplayPolicy?: DesktopAgentModelDisplayPolicy | null;
  promptCapabilities?: DesktopAgentPromptCapabilities | null;
  compatibility?: Record<string, unknown> | null;
  models: CloudAgentCatalogModelInput[];
  controls: CloudAgentCatalogControlInput[];
}

interface CloudAgentCatalogModelInput {
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

interface CloudAgentCatalogControlInput {
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

interface CloudAgentCatalogControlValueInput {
  value: string;
  label: string;
  description?: string | null;
  isDefault: boolean;
  status?: DesktopAgentCatalogStatus | null;
}

interface ProjectCloudAgentCatalogOptions {
  workspaceId?: string | null;
}

const DEFAULT_CONTROL_SURFACES: DesktopAgentLaunchControlSurfaces = {
  start: false,
  session: false,
  automation: false,
  settings: false,
};

export function projectCloudAgentCatalogToDesktopLaunchCatalog(
  catalog: CloudAgentCatalogResponseInput,
  options: ProjectCloudAgentCatalogOptions = {},
): DesktopAgentLaunchCatalog {
  return {
    schemaVersion: catalog.schemaVersion,
    catalogVersion: catalog.catalogVersion,
    generatedAt: catalog.generatedAt,
    workspaceId: options.workspaceId ?? null,
    agents: catalog.agents
      .map(projectCloudAgent)
      .filter((agent) => agent.models.length > 0),
  };
}

export function buildDesktopLaunchModelRegistries(
  agents: readonly DesktopAgentLaunchAgent[],
): DesktopLaunchModelRegistry[] {
  return agents.map((agent) => ({
    kind: agent.kind,
    displayName: agent.displayName,
    defaultModelId: agent.defaultModelId,
    models: agent.models,
  }));
}

export function mergeRuntimeLaunchOptionsIntoDesktopLaunchModelRegistries(
  cloudRegistries: readonly DesktopLaunchModelRegistry[],
  runtimeAgents: readonly RuntimeAgentLaunchOptions[] | null | undefined,
  options: { includeCloudOnlyAgents?: boolean } = {},
): DesktopLaunchModelRegistry[] {
  return buildDesktopLaunchModelRegistries(
    mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents(
      cloudRegistries.map((registry) => ({
        kind: registry.kind,
        displayName: registry.displayName,
        description: null,
        defaultModelId: registry.defaultModelId ?? null,
        defaultModeId: null,
        dynamicModels: true,
        modelDisplayPolicy: null,
        promptCapabilities: null,
        models: registry.models.map((model) => ({
          ...model,
          aliases: model.aliases ?? [],
          status: model.status ?? "active",
          provider: null,
          tags: [],
          launchRemediation: model.launchRemediation ?? null,
        })),
        launchControls: [],
      })),
      runtimeAgents,
      options,
    ),
  );
}

export function mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents(
  cloudAgents: readonly DesktopAgentLaunchAgent[],
  runtimeAgents: readonly RuntimeAgentLaunchOptions[] | null | undefined,
  options: { includeCloudOnlyAgents?: boolean } = {},
): DesktopAgentLaunchAgent[] {
  if (!runtimeAgents || runtimeAgents.length === 0) {
    return [...cloudAgents];
  }

  const cloudByKind = new Map(cloudAgents.map((agent) => [agent.kind, agent]));
  const runtimeKinds = new Set(runtimeAgents.map((agent) => agent.kind));

  const mergedAgents = runtimeAgents.map((agent) => {
    const cloud = cloudByKind.get(agent.kind);
    const cloudModelsByIdOrAlias = buildCloudModelLookup(cloud);
    const defaultModelId = agent.defaultModelId ?? cloud?.defaultModelId ?? null;

    return {
      kind: agent.kind,
      displayName: cloud?.displayName ?? agent.displayName,
      description: cloud?.description ?? null,
      defaultModelId,
      defaultModeId: cloud?.defaultModeId ?? null,
      dynamicModels: cloud?.dynamicModels ?? true,
      modelDisplayPolicy: cloud?.modelDisplayPolicy ?? null,
      promptCapabilities: cloud?.promptCapabilities ?? null,
      models: agent.models.map((model) => {
        const cloudModel =
          cloudModelsByIdOrAlias.get(model.id)
          ?? model.aliases?.map((alias) => cloudModelsByIdOrAlias.get(alias)).find(Boolean)
          ?? null;
        return {
          ...cloudModel,
          id: model.id,
          displayName: model.displayName,
          description: cloudModel?.description ?? null,
          aliases: mergeModelAliases(model.id, model.aliases ?? [], cloudModel),
          status: cloudModel?.status ?? "active",
          isDefault: model.isDefault || model.id === defaultModelId,
          defaultOptIn: model.defaultOptIn ?? cloudModel?.defaultOptIn ?? null,
          provider: cloudModel?.provider ?? null,
          tags: cloudModel?.tags ?? [],
          launchRemediation: cloudModel?.launchRemediation ?? null,
          sessionDefaultControls: cloudModel?.sessionDefaultControls ?? [],
        };
      }),
      launchControls: cloud?.launchControls ?? [],
    };
  });

  if (!options.includeCloudOnlyAgents) {
    return mergedAgents;
  }

  return [
    ...mergedAgents,
    ...cloudAgents.filter((agent) => !runtimeKinds.has(agent.kind)),
  ];
}

function buildCloudModelLookup(
  cloud: DesktopAgentLaunchAgent | undefined,
): Map<string, DesktopAgentLaunchModel> {
  const modelsByIdOrAlias = new Map<string, DesktopAgentLaunchModel>();
  for (const model of cloud?.models ?? []) {
    modelsByIdOrAlias.set(model.id, model);
    for (const alias of model.aliases) {
      if (!modelsByIdOrAlias.has(alias)) {
        modelsByIdOrAlias.set(alias, model);
      }
    }
  }
  return modelsByIdOrAlias;
}

function mergeModelAliases(
  runtimeModelId: string,
  runtimeAliases: readonly string[],
  cloudModel: DesktopAgentLaunchModel | null,
): string[] {
  const aliases = new Set<string>();
  for (const alias of runtimeAliases) {
    if (alias !== runtimeModelId) {
      aliases.add(alias);
    }
  }
  if (cloudModel && cloudModel.id !== runtimeModelId) {
    aliases.add(cloudModel.id);
  }
  for (const alias of cloudModel?.aliases ?? []) {
    if (alias !== runtimeModelId) {
      aliases.add(alias);
    }
  }
  return [...aliases];
}

export function dynamicLaunchAgentAcceptsModel(
  agent: Pick<DesktopAgentLaunchAgent, "dynamicModels" | "modelDisplayPolicy">,
): boolean {
  return agent.dynamicModels
    && agent.modelDisplayPolicy?.moreModelsSource !== "none";
}

function projectCloudAgent(agent: CloudAgentCatalogAgentInput): DesktopAgentLaunchAgent {
  const visibleModels = agent.session.models
    .filter(isLaunchVisibleModel)
    .map(projectCloudModel);
  const defaultModelId = resolveDefaultModelId(
    agent.session.defaultModelId,
    visibleModels,
  );
  const defaultSessionControls = projectSessionDefaultControls(agent.session.controls);
  const models = visibleModels.map((model) => ({
    ...model,
    isDefault: model.id === defaultModelId,
    sessionDefaultControls: defaultSessionControls,
  }));
  const launchControls = agent.session.controls
    .filter((control) =>
      control.key !== "model"
      && (control.surfaces.start || control.surfaces.session)
    )
    .map((control) => projectCloudControl(control, defaultModelId));

  return {
    kind: agent.kind,
    displayName: agent.displayName,
    description: agent.description ?? null,
    defaultModelId,
    defaultModeId: agent.session.defaultModeId ?? null,
    dynamicModels: agent.session.dynamicModels,
    modelDisplayPolicy: agent.session.modelDisplayPolicy ?? null,
    promptCapabilities: agent.session.promptCapabilities ?? null,
    models,
    launchControls,
  };
}

function isLaunchVisibleModel(model: CloudAgentCatalogModelInput): boolean {
  return model.status === "active";
}

function projectCloudModel(model: CloudAgentCatalogModelInput): DesktopAgentLaunchModel {
  return {
    id: model.id,
    displayName: model.displayName,
    description: model.description ?? null,
    aliases: model.aliases ?? [],
    status: model.status,
    isDefault: model.isDefault,
    defaultOptIn: model.defaultOptIn ?? null,
    provider: model.provider ?? null,
    tags: model.tags ?? [],
    launchRemediation: model.launchRemediation
      ? {
        kind: model.launchRemediation.kind,
        message: model.launchRemediation.message,
      }
      : null,
  };
}

function resolveDefaultModelId(
  catalogDefaultModelId: string,
  models: readonly DesktopAgentLaunchModel[],
): string | null {
  return models.find((model) => model.id === catalogDefaultModelId)?.id
    ?? models.find((model) => model.isDefault)?.id
    ?? models[0]?.id
    ?? null;
}

function projectCloudControl(
  control: CloudAgentCatalogControlInput,
  defaultModelId: string | null,
): DesktopAgentLaunchControl {
  const createField = control.apply.createField ?? null;

  return {
    key: control.key,
    label: control.label,
    description: control.description ?? null,
    type: control.type,
    category: control.category ?? null,
    defaultValue: control.defaultValue ?? (
      createField === "modelId" ? defaultModelId : null
    ),
    createField,
    phase: createField ? "create_session" : "live_default",
    surfaces: control.surfaces ?? DEFAULT_CONTROL_SURFACES,
    apply: {
      createField,
      liveConfigId: control.apply.liveConfigId ?? null,
      liveSetter: control.apply.liveSetter ?? null,
      queueBeforeMaterialized: control.apply.queueBeforeMaterialized,
    },
    missingLiveConfigPolicy: control.missingLiveConfigPolicy,
    valueSource: control.valueSource,
    values: resolveControlValues(control),
    queueWhileMaterializing: control.queueWhileMaterializing,
    mutableAfterMaterialized: control.mutableAfterMaterialized,
  };
}

function resolveControlValues(
  control: CloudAgentCatalogControlInput,
): DesktopAgentLaunchControlValue[] {
  return control.values
    .filter((value) => value.status !== "hidden")
    .map(projectCloudControlValue);
}

function projectCloudControlValue(
  value: CloudAgentCatalogControlValueInput,
): DesktopAgentLaunchControlValue {
  return {
    value: value.value,
    label: value.label,
    description: value.description ?? null,
    isDefault: value.isDefault,
    status: value.status ?? null,
  };
}

function projectSessionDefaultControls(
  controls: readonly CloudAgentCatalogControlInput[],
): DesktopSessionDefaultControl[] {
  return controls.flatMap((control) => {
    if (!isSessionDefaultControlKey(control.key) || control.values.length === 0) {
      return [];
    }
    return [{
      key: control.key,
      label: control.label,
      defaultValue: control.defaultValue,
      values: control.values
        .filter((value) => value.status !== "hidden")
        .map((value) => ({
          value: value.value,
          label: value.label,
          description: value.description ?? null,
          isDefault: value.isDefault,
        })),
    }];
  });
}

function isSessionDefaultControlKey(
  value: string,
): value is DesktopSessionDefaultControl["key"] {
  return value === "reasoning" || value === "effort" || value === "fast_mode";
}
