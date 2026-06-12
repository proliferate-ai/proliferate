import type {
  CloudAgentCatalogAgent,
  CloudAgentCatalogModel,
  CloudAgentCatalogResponse,
} from "@proliferate/cloud-sdk";
import { modelMatchesSelectedValue } from "./composer-control-identity";
import {
  DEFAULT_CLOUD_LAUNCHABLE_AGENT_KINDS,
  normalizeCloudAgentKindList,
} from "./harness-availability";
import { DEFAULT_DIRECT_PROMPT_AGENT_KIND } from "./composer-launch-defaults";
import type { CloudLaunchComposerSelection } from "./composer-control-model";

/**
 * Launch control projected from a v2 catalog session control: raw string
 * values become labelled options, `mapping.createField`/`liveConfigId`
 * replace the v1 apply block, and the catalog default comes from the agent's
 * default model option matrix (explicit `default`, else probe-observed).
 */
export interface ComposerLaunchControl {
  key: string;
  label: string;
  createField: "modelId" | "modeId" | null;
  liveConfigId: string;
  defaultValue: string | null;
  values: Array<{ value: string; label: string; isDefault: boolean }>;
}

/** Catalog control key -> composer control key (v1 vocabulary). */
const COMPOSER_LAUNCH_CONTROL_KEYS: Readonly<Record<string, string>> = {
  mode: "mode",
  collaboration_mode: "collaboration_mode",
  reasoning: "reasoning",
  reasoning_effort: "effort",
  effort: "effort",
  fast_mode: "fast_mode",
};

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
): CloudAgentCatalogModel | null {
  return agent.session.models.find((model) =>
    isLaunchVisibleModel(model)
    && (model.id === modelId || (modelId ? model.aliases.includes(modelId) : false))
  )
    ?? defaultLaunchModel(agent);
}

/**
 * Curation default (mirrors the runtime catalog service, sans active-context
 * knowledge): first `session.defaults` entry in declared auth-context order
 * resolving to a menu model, else the first menu model in document order.
 */
export function defaultLaunchModel(
  agent: CloudAgentCatalogAgent,
): CloudAgentCatalogModel | null {
  for (const context of agent.authContexts) {
    const defaultId = agent.session.defaults[context.id];
    if (!defaultId) {
      continue;
    }
    const model = agent.session.models.find((candidate) =>
      isLaunchVisibleModel(candidate)
      && (candidate.id === defaultId || candidate.aliases.includes(defaultId))
    );
    if (model) {
      return model;
    }
  }
  return agent.session.models.find(isLaunchVisibleModel) ?? null;
}

/**
 * Project the agent's v2 session controls into composer launch controls.
 * `model` never projects; unknown keys (e.g. cursor's bracket-param toggles)
 * have no composer application path.
 */
export function launchComposerControls(
  agent: CloudAgentCatalogAgent,
): ComposerLaunchControl[] {
  const defaultModel = defaultLaunchModel(agent);
  return agent.session.controls.flatMap((control) => {
    const composerKey = COMPOSER_LAUNCH_CONTROL_KEYS[control.key];
    if (control.key === "model" || !composerKey || control.values.length === 0) {
      return [];
    }
    const modelControl = defaultModel?.controls[control.key] ?? null;
    const defaultValue = modelControl?.default ?? modelControl?.observedValue ?? null;
    const createField = normalizeCreateField(control.mapping?.createField)
      ?? (composerKey === "mode" ? "modeId" : null);
    return [{
      key: composerKey,
      label: control.label ?? humanizeControlToken(composerKey),
      createField,
      liveConfigId: control.mapping?.liveConfigId ?? control.key,
      defaultValue,
      values: control.values.map((value) => ({
        value,
        label: humanizeControlToken(value),
        isDefault: value === defaultValue,
      })),
    }];
  });
}

export function selectedLaunchControlValue(
  agent: CloudAgentCatalogAgent,
  control: ComposerLaunchControl,
  selection: CloudLaunchComposerSelection,
): string | null {
  if (control.createField === "modeId" && selection.modeId) {
    return selection.modeId;
  }
  const explicit = selection.controlValues[control.key];
  if (explicit) {
    return explicit;
  }
  const selectedModelDefault = selectedModelControlDefault(agent, control, selection);
  return selectedModelDefault
    ?? control.defaultValue
    ?? control.values.find((option) => option.isDefault)?.value
    ?? control.values[0]?.value
    ?? null;
}

function selectedModelControlDefault(
  agent: CloudAgentCatalogAgent,
  control: ComposerLaunchControl,
  selection: CloudLaunchComposerSelection,
): string | null {
  if (!selection.modelId) {
    return null;
  }
  const model = selectLaunchModel(agent, selection.modelId);
  const modelControl = model?.controls[control.liveConfigId]
    ?? model?.controls[control.key]
    ?? null;
  return modelControl?.default ?? modelControl?.observedValue ?? null;
}

export function visibleComposerModels(input: {
  agent: CloudAgentCatalogAgent;
  selectedModelId?: string | null;
  selectedLabel?: string | null;
  selectedValue?: string | null;
}): CloudAgentCatalogModel[] {
  const selectedModelId = input.selectedModelId ?? null;
  const selectedLabel = input.selectedLabel ?? null;
  const selectedValue = input.selectedValue ?? selectedModelId;
  const models = input.agent.session.models.filter((model) =>
    isLaunchVisibleModel(model)
    || modelMatchesSelectedValue({
      displayName: model.displayName,
      id: model.id,
      selectedLabel,
      selectedValue,
    })
  );
  const fallback = input.agent.session.models.find((model) =>
    model.id === selectedModelId && model.status === "active"
  ) ?? defaultLaunchModel(input.agent);
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

/**
 * The v2 menu rule (mirrors the runtime catalog service): `defaultVisible` ∩
 * `status == "active"`. Availability gating happens server-side before the
 * cloud session launches.
 */
function isLaunchVisibleModel(model: CloudAgentCatalogModel): boolean {
  return model.status === "active" && model.defaultVisible;
}

function normalizeCreateField(
  createField: string | null | undefined,
): "modelId" | "modeId" | null {
  return createField === "modelId" || createField === "modeId" ? createField : null;
}

const CONTROL_TOKEN_LABELS: Readonly<Record<string, string>> = {
  dontAsk: "Don't Ask",
  xhigh: "Extra High",
  yolo: "YOLO",
  mode: "Mode",
  collaboration_mode: "Collaboration Mode",
  reasoning: "Reasoning",
  effort: "Effort",
  fast_mode: "Fast Mode",
};

function humanizeControlToken(token: string): string {
  const known = CONTROL_TOKEN_LABELS[token];
  if (known) {
    return known;
  }
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
