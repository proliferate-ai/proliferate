import type {
  CloudAgentCatalogAgent,
  CloudAgentCatalogControl,
  CloudAgentCatalogResponse,
} from "@proliferate/cloud-sdk";
import { modelMatchesSelectedValue } from "./composer-control-identity";
import {
  DEFAULT_CLOUD_LAUNCHABLE_AGENT_KINDS,
  normalizeCloudAgentKindList,
} from "./harness-availability";
import { DEFAULT_DIRECT_PROMPT_AGENT_KIND } from "./composer-launch-defaults";
import type { CloudLaunchComposerSelection } from "./composer-control-model";

export function launchableCatalogAgents(input: {
  agents: readonly CloudAgentCatalogAgent[];
  launchableAgentKinds?: readonly string[] | null;
  includeAgentKind?: string | null;
}): CloudAgentCatalogAgent[] {
  const launchableKinds = normalizeCloudAgentKindList(
    input.launchableAgentKinds ?? DEFAULT_CLOUD_LAUNCHABLE_AGENT_KINDS,
  );
  const allowed = new Set(launchableKinds);
  if (input.includeAgentKind) {
    allowed.add(input.includeAgentKind);
  }
  return input.agents.filter((agent) => allowed.has(agent.kind));
}

export function shouldShowUnavailableLaunchControls(input: {
  catalog?: CloudAgentCatalogResponse | null;
  launchableAgentKinds?: readonly string[] | null;
}): boolean {
  if (input.launchableAgentKinds !== undefined && input.launchableAgentKinds !== null) {
    return normalizeCloudAgentKindList(input.launchableAgentKinds).length === 0
      || Boolean(input.catalog?.agents?.length);
  }
  return Boolean(input.catalog?.agents?.length);
}

export function selectLaunchAgent(
  agents: readonly CloudAgentCatalogAgent[],
  agentKind: string | null | undefined,
): CloudAgentCatalogAgent | null {
  return agents.find((agent) => agent.kind === agentKind)
    ?? agents.find((agent) => agent.kind === DEFAULT_DIRECT_PROMPT_AGENT_KIND)
    ?? agents[0]
    ?? null;
}

export function selectLaunchModel(
  agent: CloudAgentCatalogAgent,
  modelId: string | null | undefined,
) {
  return agent.session.models.find((model) => model.id === modelId && isLaunchVisibleModel(model))
    ?? agent.session.models.find((model) => model.id === agent.session.defaultModelId)
    ?? agent.session.models.find(isLaunchVisibleModel)
    ?? null;
}

export function selectedLaunchControlValue(
  agent: CloudAgentCatalogAgent,
  control: CloudAgentCatalogControl,
  selection: CloudLaunchComposerSelection,
): string | null {
  if (control.apply?.createField === "modeId" && selection.modeId) {
    return selection.modeId;
  }
  const explicit = selection.controlValues[control.key];
  if (explicit) {
    return explicit;
  }
  if (control.apply?.createField === "modeId" && agent.session.defaultModeId) {
    return agent.session.defaultModeId;
  }
  return control.defaultValue
    ?? control.values.find((option) => option.isDefault)?.value
    ?? control.values[0]?.value
    ?? null;
}

export function isLaunchComposerControl(control: CloudAgentCatalogControl): boolean {
  return isStartSurfaceControl(control) || isQueueableLaunchSessionControl(control);
}

export function visibleComposerModels(input: {
  agent: CloudAgentCatalogAgent;
  selectedModelId?: string | null;
  selectedLabel?: string | null;
  selectedValue?: string | null;
}): CloudAgentCatalogAgent["session"]["models"] {
  const selectedModelId = input.selectedModelId ?? null;
  const selectedLabel = input.selectedLabel ?? null;
  const selectedValue = input.selectedValue ?? selectedModelId;
  const models = input.agent.session.models.filter((model) =>
    isLaunchVisibleModel(model)
    && (
      isCatalogDefaultVisibleModel(input.agent, model)
      || modelMatchesSelectedValue({
        displayName: model.displayName,
        id: model.id,
        selectedLabel,
        selectedValue,
      })
    )
  );
  const fallback = input.agent.session.models.find((model) =>
    isLaunchVisibleModel(model)
    && (
      model.id === selectedModelId
      || model.id === input.agent.session.defaultModelId
      || model.isDefault
    )
  ) ?? input.agent.session.models.find(isLaunchVisibleModel) ?? null;
  if (models.length === 0 && fallback) {
    return [fallback];
  }
  return models;
}

export function launchAgentModelOptionId(agentKind: string, modelId: string): string {
  return `${encodeURIComponent(agentKind)}:${encodeURIComponent(modelId)}`;
}

export function parseLaunchAgentModelOptionId(
  optionId: string,
): { agentKind: string; modelId: string } | null {
  const separator = optionId.indexOf(":");
  if (separator <= 0 || separator === optionId.length - 1) {
    return null;
  }
  return {
    agentKind: decodeURIComponent(optionId.slice(0, separator)),
    modelId: decodeURIComponent(optionId.slice(separator + 1)),
  };
}

function isStartSurfaceControl(control: CloudAgentCatalogControl): boolean {
  return Boolean(control.surfaces?.start && control.values.length > 0);
}

function isQueueableLaunchSessionControl(control: CloudAgentCatalogControl): boolean {
  return Boolean(
    control.surfaces?.session
    && control.apply?.liveConfigId
    && control.apply?.queueBeforeMaterialized
    && control.values.length > 0
  );
}

function isLaunchVisibleModel(model: CloudAgentCatalogAgent["session"]["models"][number]): boolean {
  return model.status === "active" || model.status === "candidate";
}

function isCatalogDefaultVisibleModel(
  agent: CloudAgentCatalogAgent,
  model: CloudAgentCatalogAgent["session"]["models"][number],
): boolean {
  if (typeof model.defaultOptIn === "boolean") {
    return model.defaultOptIn;
  }
  return Boolean(
    agent.session.modelDisplayPolicy?.defaultVisibleModelIds.includes(model.id)
    || model.isDefault
    || model.tags.includes("recommended")
  );
}
