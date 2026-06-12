import type {
  CloudAgentCatalogAgentInput,
  CloudAgentCatalogControlInput,
  CloudAgentCatalogModelInput,
  CloudAgentCatalogResponseInput,
  DesktopAgentLaunchAgent,
  DesktopAgentLaunchCatalog,
  DesktopAgentLaunchControl,
  DesktopAgentLaunchModel,
  DesktopLaunchModelRegistry,
  DesktopSessionDefaultControl,
  ProjectCloudAgentCatalogOptions,
  RuntimeAgentLaunchOptions,
} from "./cloud-launch-catalog-types";
import { gateModelList, type ActiveAuthContextIds } from "./model-availability";
import {
  normalizeDefaultChatModelId,
} from "@/lib/domain/preferences/user/session-defaults";

export type {
  CloudAgentCatalogResponseInput,
  DesktopAgentCatalogStatus,
  DesktopAgentLaunchAgent,
  DesktopAgentLaunchCatalog,
  DesktopAgentLaunchControl,
  DesktopAgentLaunchControlApply,
  DesktopAgentLaunchControlPhase,
  DesktopAgentLaunchControlSurfaces,
  DesktopAgentLaunchControlValue,
  DesktopAgentLaunchModel,
  DesktopLaunchModelRegistry,
  DesktopLaunchModelRegistryModel,
  DesktopSessionDefaultControl,
  DesktopSessionDefaultControlValue,
  RuntimeAgentLaunchOptions,
} from "./cloud-launch-catalog-types";

export interface MergeRuntimeLaunchOptionsOptions {
  includeCloudOnlyAgents?: boolean;
  /**
   * Last-known active auth context ids for the target. When provided,
   * catalog-only models (no runtime confirmation) are gated against them
   * and only enabled models are emitted — the desktop has no gated-model
   * rendering yet. When null/undefined the menu stays optimistic.
   */
  activeAuthContextIds?: ActiveAuthContextIds | null;
}

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
  options: MergeRuntimeLaunchOptionsOptions = {},
): DesktopLaunchModelRegistry[] {
  return buildDesktopLaunchModelRegistries(
    mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents(
      cloudRegistries.map((registry) => ({
        kind: registry.kind,
        displayName: registry.displayName,
        description: null,
        defaultModelId: registry.defaultModelId ?? null,
        models: registry.models.map((model) => ({
          ...model,
          aliases: model.aliases ?? [],
          status: model.status ?? "active",
        })),
        launchControls: [],
      })),
      runtimeAgents,
      options,
    ),
  );
}

/**
 * Merge the runtime launch-options menu (the availability truth: models are
 * pre-filtered to visible + available under the classified auth contexts)
 * with the cloud v2 catalog (the metadata truth: descriptions, aliases,
 * controls). Runtime agents and models win; catalog data enriches by id or
 * alias; catalog-only agents survive only as a fallback when the runtime has
 * no data (e.g. cloud-only settings surfaces before a runtime is up).
 */
export function mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents(
  cloudAgents: readonly DesktopAgentLaunchAgent[],
  runtimeAgents: readonly RuntimeAgentLaunchOptions[] | null | undefined,
  options: MergeRuntimeLaunchOptionsOptions = {},
): DesktopAgentLaunchAgent[] {
  const activeContexts = options.activeAuthContextIds ?? null;
  if (!runtimeAgents || runtimeAgents.length === 0) {
    return cloudAgents.map((agent) => dropGatedCatalogModels(agent, activeContexts));
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
      models: agent.models.map((model) => {
        const modelIdCandidates = runtimeModelCatalogLookupCandidates(
          agent.kind,
          model.id,
          model.aliases ?? [],
        );
        const cloudModel = modelIdCandidates
          .map((candidate) => cloudModelsByIdOrAlias.get(candidate))
          .find(Boolean) ?? null;
        return {
          id: model.id,
          displayName: resolveRuntimeMergedModelDisplayName(model, cloudModel),
          description: cloudModel?.description ?? null,
          aliases: mergeModelAliases(model.id, model.aliases ?? [], cloudModel),
          status: cloudModel?.status ?? "active",
          isDefault: model.isDefault || modelIdCandidates.includes(defaultModelId ?? ""),
          availability: cloudModel?.availability ?? null,
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
    ...cloudAgents
      .filter((agent) => !runtimeKinds.has(agent.kind))
      .map((agent) => dropGatedCatalogModels(agent, activeContexts)),
  ];
}

/**
 * Catalog-only fallback path: when the active auth contexts are known, gate
 * each model (`availability.anyOf` ∩ active contexts) and emit only enabled
 * models. Gated entries are dropped because no desktop surface renders a
 * locked model row yet. Unknown contexts keep the optimistic full menu.
 */
function dropGatedCatalogModels(
  agent: DesktopAgentLaunchAgent,
  activeContexts: ActiveAuthContextIds | null,
): DesktopAgentLaunchAgent {
  if (!activeContexts) {
    return agent;
  }

  const models = gateModelList(agent.models, activeContexts)
    .filter((model) => model.decision.state === "enabled")
    .map(({ decision: _decision, ...model }) => model);
  if (models.length === agent.models.length) {
    return agent;
  }

  const defaultModelId =
    models.find((model) => model.id === agent.defaultModelId)?.id
    ?? models.find((model) => model.isDefault)?.id
    ?? models[0]?.id
    ?? null;
  return { ...agent, defaultModelId, models };
}

function runtimeModelCatalogLookupCandidates(
  agentKind: string,
  runtimeModelId: string,
  runtimeAliases: readonly string[],
): string[] {
  const candidates = new Set<string>();
  for (const modelId of [runtimeModelId, ...runtimeAliases]) {
    candidates.add(modelId);
    candidates.add(normalizeDefaultChatModelId(agentKind, modelId));
  }
  return [...candidates];
}

function resolveRuntimeMergedModelDisplayName(
  runtimeModel: RuntimeAgentLaunchOptions["models"][number],
  cloudModel: DesktopAgentLaunchModel | null,
): string {
  const runtimeDisplayName = runtimeModel.displayName.trim();
  return runtimeDisplayName
    && !isRawRuntimeModelDisplayName(runtimeDisplayName, runtimeModel.id)
    ? runtimeModel.displayName
    : cloudModel?.displayName ?? runtimeModel.displayName;
}

function isRawRuntimeModelDisplayName(displayName: string, modelId: string): boolean {
  if (displayName === modelId) {
    return true;
  }
  return displayName === displayName.toLowerCase()
    && /[-/:[\]=]/.test(displayName);
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

function projectCloudAgent(agent: CloudAgentCatalogAgentInput): DesktopAgentLaunchAgent {
  const sessionControls = agent.session.controls ?? [];
  const menuModels = agent.session.models.filter(isMenuModel);
  const defaultModelId = resolveDefaultModelId(agent, menuModels);
  const models = menuModels.map((model) => projectCloudModel(
    model,
    sessionControls,
    defaultModelId,
  ));
  const launchControls = sessionControls.flatMap(projectCloudControl);

  return {
    kind: agent.kind,
    displayName: agent.displayName,
    description: agent.description ?? null,
    defaultModelId,
    models,
    launchControls,
  };
}

/**
 * The menu (mirrors `visible_models` in the runtime catalog service):
 * `defaultVisible` ∩ `status == "active"`. Availability intersection happens
 * later, in the runtime merge / gating step.
 */
function isMenuModel(model: CloudAgentCatalogModelInput): boolean {
  return (model.status ?? "active") === "active" && model.defaultVisible !== false;
}

/**
 * Curation default (mirrors `default_model` in the runtime catalog service,
 * sans active-context knowledge): first `session.defaults` entry in declared
 * auth-context order that resolves to a menu model, else the first menu
 * model in document order.
 */
function resolveDefaultModelId(
  agent: CloudAgentCatalogAgentInput,
  menuModels: readonly CloudAgentCatalogModelInput[],
): string | null {
  const defaults = agent.session.defaults ?? {};
  for (const context of agent.authContexts ?? []) {
    const defaultId = defaults[context.id];
    if (!defaultId) {
      continue;
    }
    const model = menuModels.find((candidate) =>
      candidate.id === defaultId || (candidate.aliases ?? []).includes(defaultId)
    );
    if (model) {
      return model.id;
    }
  }
  return menuModels[0]?.id ?? null;
}

function projectCloudModel(
  model: CloudAgentCatalogModelInput,
  sessionControls: readonly CloudAgentCatalogControlInput[],
  defaultModelId: string | null,
): DesktopAgentLaunchModel {
  const anyOf = model.availability?.anyOf ?? [];
  return {
    id: model.id,
    displayName: model.displayName,
    description: model.description ?? null,
    aliases: model.aliases ?? [],
    status: model.status ?? "active",
    isDefault: model.id === defaultModelId,
    availability: anyOf.length > 0 ? { anyOf: [...anyOf] } : null,
    sessionDefaultControls: projectSessionDefaultControls(model, sessionControls),
  };
}

const SESSION_DEFAULT_CONTROL_KEYS: ReadonlyArray<{
  key: DesktopSessionDefaultControl["key"];
  catalogKeys: readonly string[];
}> = [
  { key: "reasoning", catalogKeys: ["reasoning"] },
  { key: "effort", catalogKeys: ["effort", "reasoning_effort"] },
  { key: "fast_mode", catalogKeys: ["fast_mode"] },
];

/**
 * Per-model live-default controls from the v2 per-model option matrix
 * (`model.controls`), falling back to the agent-level vocabulary when the
 * model carries no entry for a key. The catalog default is the explicit
 * `default`, else the probe-observed value.
 */
function projectSessionDefaultControls(
  model: CloudAgentCatalogModelInput,
  sessionControls: readonly CloudAgentCatalogControlInput[],
): DesktopSessionDefaultControl[] {
  return SESSION_DEFAULT_CONTROL_KEYS.flatMap(({ key, catalogKeys }) => {
    for (const catalogKey of catalogKeys) {
      const modelControl = model.controls?.[catalogKey];
      const values = modelControl?.values
        ?? sessionControls.find((control) => control.key === catalogKey)?.values;
      if (!values || values.length === 0) {
        continue;
      }
      const defaultValue = modelControl?.default
        ?? modelControl?.observedValue
        ?? null;
      return [{
        key,
        label: launchControlLabel(key),
        defaultValue,
        values: values.map((value) => ({
          value,
          label: controlValueLabel(value),
          description: null,
          isDefault: value === defaultValue,
        })),
      }];
    }
    return [];
  });
}

/**
 * Desktop launch-control key normalization (catalog control key -> desktop
 * control key). Whether a control projects at all is decided by its catalog
 * MAPPING: a control without a createField or liveConfigId is a
 * probe-observed matrix dimension (e.g. cursor's bracket-param
 * effort/reasoning/thinking/context) with no application path — projecting
 * it would render a knob that does nothing. Single-value controls carry no
 * choice and are likewise skipped.
 */
const LAUNCH_CONTROL_KEYS: Readonly<Record<string, string>> = {
  mode: "mode",
  collaboration_mode: "collaboration_mode",
  reasoning: "reasoning",
  reasoning_effort: "effort",
  effort: "effort",
  fast_mode: "fast_mode",
};

function projectCloudControl(
  control: CloudAgentCatalogControlInput,
): DesktopAgentLaunchControl[] {
  const desktopKey = LAUNCH_CONTROL_KEYS[control.key];
  const values = control.values ?? [];
  const hasApplicationPath =
    Boolean(control.mapping?.createField) || Boolean(control.mapping?.liveConfigId);
  if (
    control.key === "model"
    || !desktopKey
    || !hasApplicationPath
    || values.length < 2
  ) {
    return [];
  }

  const createField = control.mapping?.createField ?? null;

  return [{
    key: desktopKey,
    label: control.label ?? launchControlLabel(desktopKey),
    description: null,
    type: "select",
    category: null,
    defaultValue: null,
    createField,
    phase: createField ? "create_session" : "live_default",
    surfaces: { start: true, session: true, automation: true, settings: true },
    apply: {
      createField,
      liveConfigId: control.mapping?.liveConfigId ?? control.key,
      liveSetter: "runtime_control",
      queueBeforeMaterialized: true,
    },
    missingLiveConfigPolicy: "ignore_default",
    valueSource: "inline",
    values: values.map((value) => ({
      value,
      label: controlValueLabel(value),
      description: null,
      isDefault: false,
      status: null,
    })),
    queueWhileMaterializing: true,
    mutableAfterMaterialized: true,
  }];
}

const LAUNCH_CONTROL_LABELS: Readonly<Record<string, string>> = {
  mode: "Mode",
  collaboration_mode: "Collaboration Mode",
  reasoning: "Reasoning",
  effort: "Effort",
  fast_mode: "Fast Mode",
};

function launchControlLabel(key: string): string {
  return LAUNCH_CONTROL_LABELS[key] ?? humanizeControlToken(key);
}

const CONTROL_VALUE_LABELS: Readonly<Record<string, string>> = {
  dontAsk: "Don't Ask",
  xhigh: "Extra High",
  yolo: "YOLO",
};

function controlValueLabel(value: string): string {
  return CONTROL_VALUE_LABELS[value] ?? humanizeControlToken(value);
}

function humanizeControlToken(token: string): string {
  const spaced = token
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  if (!spaced) {
    return token;
  }
  return spaced
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
