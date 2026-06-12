import type {
  CloudAgentCatalogAgentInput,
  CloudAgentCatalogControlInput,
  CloudAgentCatalogModelInput,
  CloudAgentCatalogResponseInput,
  DesktopAgentLaunchAgent,
  DesktopAgentLaunchCatalog,
  DesktopAgentLaunchModel,
  DesktopLaunchModelRegistry,
  ProjectCloudAgentCatalogOptions,
  RuntimeAgentLaunchOptions,
} from "./cloud-launch-catalog-types";
import {
  projectCloudControl,
  projectSessionDefaultControls,
} from "./cloud-launch-controls";
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
