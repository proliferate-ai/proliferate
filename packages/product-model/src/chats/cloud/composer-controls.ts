import type {
  NormalizedSessionControl,
  SessionLiveConfigSnapshot,
} from "@anyharness/sdk";
import type {
  CloudAgentCatalogAgent,
  CloudAgentCatalogControl,
  CloudAgentCatalogResponse,
  CloudSessionProjection,
} from "@proliferate/cloud-sdk";

export interface CloudChatComposerControlOptionView {
  id: string;
  label: string;
  description?: string | null;
  selected?: boolean;
  disabled?: boolean;
}

export interface CloudChatComposerControlGroupView {
  id: string;
  label?: string | null;
  options: readonly CloudChatComposerControlOptionView[];
}

export interface CloudChatComposerControlView {
  id: string;
  key?: string | null;
  label: string;
  detail?: string | null;
  icon?: "bot" | "brain" | "cloud" | "settings";
  placement?: "leading" | "trailing";
  disabled?: boolean;
  active?: boolean;
  pendingState?: "sending" | "queued" | null;
  groups: readonly CloudChatComposerControlGroupView[];
  onSelect?: (optionId: string) => void;
}

export type PendingConfigStatus = "sending" | "queued";

export type PendingConfigChange = {
  sessionId: string;
  rawConfigId: string;
  value: string;
  status: PendingConfigStatus;
  mutationId: number;
  commandId?: string | null;
};

export const DEFAULT_DIRECT_PROMPT_MODEL_ID = "us.anthropic.claude-sonnet-4-6";
export const DEFAULT_DIRECT_PROMPT_AGENT_KIND = "claude";

const CLOUD_MODEL_OPTIONS = [
  {
    id: "us.anthropic.claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    description: "Balanced cloud work",
  },
] as const;

export interface LaunchSessionConfigUpdate {
  configId: string;
  value: string;
}

export interface CloudLaunchComposerSelection {
  agentKind: string;
  modelId: string | null;
  modeId: string | null;
  controlValues: Record<string, string>;
}

export interface CloudLaunchComposerControlSelection {
  controlKey: string;
  value: string;
}

export function readSessionLiveConfig(
  session: CloudSessionProjection | null,
): SessionLiveConfigSnapshot | null {
  const liveConfig = session?.liveConfig;
  if (!isRecord(liveConfig) || !isRecord(liveConfig.normalizedControls)) {
    return null;
  }
  return liveConfig as unknown as SessionLiveConfigSnapshot;
}

export function buildCloudChatComposerControls(input: {
  session: CloudSessionProjection | null;
  liveConfig: SessionLiveConfigSnapshot | null;
  pendingConfigChanges: Record<string, PendingConfigChange>;
  launchCatalog?: CloudAgentCatalogResponse | null;
  launchSelection?: CloudLaunchComposerSelection;
  launchModelId: string;
  onLaunchAgentModelSelect?: (agentKind: string, modelId: string) => void;
  onLaunchControlSelect?: (selection: CloudLaunchComposerControlSelection) => void;
  onLaunchModelSelect: (modelId: string) => void;
  onSessionConfigSelect: (rawConfigId: string, value: string) => void;
}): CloudChatComposerControlView[] {
  if (!input.session) {
    return buildCloudLaunchComposerControls({
      catalog: input.launchCatalog,
      selection: input.launchSelection ?? {
        agentKind: DEFAULT_DIRECT_PROMPT_AGENT_KIND,
        modelId: input.launchModelId,
        modeId: null,
        controlValues: {},
      },
      onAgentModelSelect: input.onLaunchAgentModelSelect ?? ((_agentKind, modelId) =>
        input.onLaunchModelSelect(modelId)),
      onControlSelect: input.onLaunchControlSelect ?? (() => undefined),
    });
  }

  const controls = collectNormalizedControls(input.liveConfig);
  const leadingModeControl = controls.find(isLeadingModeControl) ?? null;

  return controls.map((control) =>
    buildSessionConfigComposerControl({
      sessionId: input.session!.sessionId,
      control,
      placement: control.rawConfigId === leadingModeControl?.rawConfigId ? "leading" : "trailing",
      pendingConfigChanges: input.pendingConfigChanges,
      onSelect: input.onSessionConfigSelect,
    })
  );
}

export function buildCloudLaunchComposerControls(input: {
  catalog?: CloudAgentCatalogResponse | null;
  selection: CloudLaunchComposerSelection;
  onAgentModelSelect: (agentKind: string, modelId: string) => void;
  onControlSelect: (selection: CloudLaunchComposerControlSelection) => void;
}): CloudChatComposerControlView[] {
  const catalogAgents = input.catalog?.agents ?? [];
  if (catalogAgents.length === 0) {
    return fallbackLaunchComposerControls({
      modelId: input.selection.modelId ?? DEFAULT_DIRECT_PROMPT_MODEL_ID,
      onModelSelect: (modelId) =>
        input.onAgentModelSelect(input.selection.agentKind || DEFAULT_DIRECT_PROMPT_AGENT_KIND, modelId),
    });
  }

  const selectedAgent = selectLaunchAgent(catalogAgents, input.selection.agentKind);
  const modelControl = buildLaunchAgentModelControl({
    agents: catalogAgents,
    selectedAgentKind: selectedAgent?.kind ?? input.selection.agentKind,
    selectedModelId: input.selection.modelId,
    onSelect: input.onAgentModelSelect,
  });
  const configControls = selectedAgent
    ? selectedAgent.session.controls
      .filter((control) => isLaunchComposerControl(control) && control.apply?.createField !== "modelId")
      .map((control) => buildLaunchConfigControl({
        agent: selectedAgent,
        control,
        selection: input.selection,
        onSelect: input.onControlSelect,
      }))
    : [];

  return [...configControls, modelControl];
}

export function resolveCloudLaunchSelection(input: {
  catalog?: CloudAgentCatalogResponse | null;
  selection: CloudLaunchComposerSelection;
}): CloudLaunchComposerSelection {
  const agents = input.catalog?.agents ?? [];
  const agent = selectLaunchAgent(agents, input.selection.agentKind);
  if (!agent) {
    return {
      ...input.selection,
      agentKind: input.selection.agentKind || DEFAULT_DIRECT_PROMPT_AGENT_KIND,
      modelId: input.selection.modelId ?? DEFAULT_DIRECT_PROMPT_MODEL_ID,
    };
  }
  const modelId = selectLaunchModel(agent, input.selection.modelId)?.id
    ?? agent.session.defaultModelId
    ?? agent.session.models[0]?.id
    ?? null;
  const modeControl = agent.session.controls.find((control) =>
    control.apply?.createField === "modeId"
  );
  const defaultModeId = modeControl
    ? selectedLaunchControlValue(agent, modeControl, input.selection)
    : input.selection.modeId;

  return {
    ...input.selection,
    agentKind: agent.kind,
    modelId,
    modeId: defaultModeId ?? null,
  };
}

export function buildLaunchSessionConfigUpdates(input: {
  catalog?: CloudAgentCatalogResponse | null;
  selection: CloudLaunchComposerSelection;
}): LaunchSessionConfigUpdate[] {
  const agent = selectLaunchAgent(input.catalog?.agents ?? [], input.selection.agentKind);
  if (!agent) {
    return [];
  }
  return agent.session.controls.flatMap((control) => {
    if (!isLaunchComposerControl(control) || control.apply?.createField || !control.apply?.liveConfigId) {
      return [];
    }
    const value = selectedLaunchControlValue(agent, control, input.selection);
    return value ? [{ configId: control.apply.liveConfigId, value }] : [];
  });
}

export function buildLaunchRunConfigControlValues(input: {
  catalog?: CloudAgentCatalogResponse | null;
  selection: CloudLaunchComposerSelection;
}): Record<string, string> {
  const agent = selectLaunchAgent(input.catalog?.agents ?? [], input.selection.agentKind);
  if (!agent) {
    return {};
  }
  const controlValues: Record<string, string> = {};
  for (const control of agent.session.controls) {
    if (!isLaunchComposerControl(control) || control.apply?.createField === "modelId") {
      continue;
    }
    const value = selectedLaunchControlValue(agent, control, input.selection);
    if (value) {
      controlValues[control.key] = value;
    }
  }
  return controlValues;
}

export function getLiveConfigControlValue(
  liveConfig: SessionLiveConfigSnapshot,
  rawConfigId: string,
): string | null {
  return collectNormalizedControls(liveConfig).find((control) =>
    control.rawConfigId === rawConfigId
  )?.currentValue ?? null;
}

export function pendingConfigChangeKey(sessionId: string, rawConfigId: string): string {
  return `${sessionId}:${rawConfigId}`;
}

function collectNormalizedControls(
  liveConfig: SessionLiveConfigSnapshot | null,
): NormalizedSessionControl[] {
  const normalized = liveConfig?.normalizedControls;
  if (!normalized) {
    return [];
  }
  const extras = Array.isArray(normalized.extras) ? normalized.extras : [];
  const controls = [
    normalized.collaborationMode,
    normalized.mode,
    normalized.model,
    normalized.effort,
    normalized.reasoning,
    normalized.fastMode,
    ...extras,
  ].filter((control): control is NormalizedSessionControl =>
    Boolean(control && Array.isArray(control.values) && control.values.length > 0)
  );
  const seen = new Set<string>();
  return controls.filter((control) => {
    if (seen.has(control.rawConfigId)) {
      return false;
    }
    seen.add(control.rawConfigId);
    return true;
  });
}

function fallbackLaunchComposerControls(input: {
  modelId: string;
  onModelSelect: (modelId: string) => void;
}): CloudChatComposerControlView[] {
  return [
    {
      id: "launch-model",
      key: "model",
      label: "Model",
      icon: "bot",
      placement: "trailing",
      active: true,
      groups: [
        {
          id: "models",
          label: "Models",
          options: CLOUD_MODEL_OPTIONS.map((model) => ({
            ...model,
            selected: model.id === input.modelId,
          })),
        },
      ],
      onSelect: input.onModelSelect,
    },
    {
      id: "launch-mode",
      key: "mode",
      label: "Cloud task",
      detail: "Mode",
      icon: "cloud",
      placement: "leading",
      disabled: true,
      active: true,
      groups: [
        {
          id: "mode",
          options: [
            {
              id: "cloud-task",
              label: "Cloud task",
              description: "Start a session in this workspace",
              selected: true,
            },
          ],
        },
      ],
    },
  ];
}

function buildLaunchAgentModelControl(input: {
  agents: readonly CloudAgentCatalogAgent[];
  selectedAgentKind: string;
  selectedModelId: string | null;
  onSelect: (agentKind: string, modelId: string) => void;
}): CloudChatComposerControlView {
  return {
    id: "launch-agent-model",
    key: "model",
    label: "Agent",
    icon: "bot",
    placement: "trailing",
    active: true,
    groups: input.agents.map((agent) => ({
      id: agent.kind,
      label: agent.displayName,
      options: agent.session.models
        .filter(isLaunchVisibleModel)
        .map((model) => ({
          id: launchAgentModelOptionId(agent.kind, model.id),
          label: `${agent.displayName} · ${model.displayName}`,
          description: model.description ?? agent.description ?? null,
          selected: agent.kind === input.selectedAgentKind && model.id === input.selectedModelId,
        })),
    })).filter((group) => group.options.length > 0),
    onSelect: (optionId) => {
      const parsed = parseLaunchAgentModelOptionId(optionId);
      if (parsed) {
        input.onSelect(parsed.agentKind, parsed.modelId);
      }
    },
  };
}

function buildLaunchConfigControl(input: {
  agent: CloudAgentCatalogAgent;
  control: CloudAgentCatalogControl;
  selection: CloudLaunchComposerSelection;
  onSelect: (selection: CloudLaunchComposerControlSelection) => void;
}): CloudChatComposerControlView {
  const selectedValue = selectedLaunchControlValue(input.agent, input.control, input.selection);
  const selectedOption = input.control.values.find((option) => option.value === selectedValue)
    ?? input.control.values.find((option) => option.isDefault)
    ?? input.control.values[0]
    ?? null;
  const placement = input.control.apply?.createField === "modeId" ? "leading" : "trailing";
  return {
    id: `launch-control:${input.control.key}`,
    key: input.control.key,
    label: controlDisplayLabel(input.control.key, input.control.label),
    detail: selectedOption?.label ?? null,
    icon: launchControlIcon(input.control, placement),
    placement,
    active: isLaunchControlActive(input.control, selectedOption?.value ?? selectedValue),
    groups: [
      {
        id: input.control.key,
        label: input.control.label,
        options: input.control.values
          .filter(isLaunchVisibleControlValue)
          .map((option) => ({
            id: option.value,
            label: option.label,
            description: option.description ?? null,
            selected: option.value === selectedValue,
            disabled: option.value === selectedValue,
          })),
      },
    ],
    onSelect: (value) => input.onSelect({ controlKey: input.control.key, value }),
  };
}

function selectLaunchAgent(
  agents: readonly CloudAgentCatalogAgent[],
  agentKind: string | null | undefined,
): CloudAgentCatalogAgent | null {
  return agents.find((agent) => agent.kind === agentKind)
    ?? agents.find((agent) => agent.kind === DEFAULT_DIRECT_PROMPT_AGENT_KIND)
    ?? agents[0]
    ?? null;
}

function selectLaunchModel(
  agent: CloudAgentCatalogAgent,
  modelId: string | null | undefined,
) {
  return agent.session.models.find((model) => model.id === modelId && isLaunchVisibleModel(model))
    ?? agent.session.models.find((model) => model.id === agent.session.defaultModelId)
    ?? agent.session.models.find(isLaunchVisibleModel)
    ?? null;
}

function selectedLaunchControlValue(
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

function isLaunchComposerControl(control: CloudAgentCatalogControl): boolean {
  return isStartSurfaceControl(control) || isQueueableLaunchSessionControl(control);
}

function isLaunchVisibleModel(model: CloudAgentCatalogAgent["session"]["models"][number]): boolean {
  return model.status === "active" || model.status === "candidate";
}

function isLaunchVisibleControlValue(
  option: CloudAgentCatalogControl["values"][number],
): boolean {
  return option.status === undefined
    || option.status === null
    || option.status === "active"
    || option.status === "candidate";
}

function launchControlIcon(
  control: CloudAgentCatalogControl,
  placement: "leading" | "trailing",
): CloudChatComposerControlView["icon"] {
  switch (control.key) {
    case "effort":
    case "reasoning":
      return "brain";
    case "mode":
    case "collaboration_mode":
      return placement === "leading" ? "cloud" : "settings";
    default:
      return "settings";
  }
}

function isLaunchControlActive(
  control: CloudAgentCatalogControl,
  selectedValue: string | null | undefined,
): boolean {
  if (control.key !== "fast_mode" && control.key !== "reasoning") {
    return true;
  }
  const selectedOption = control.values.find((option) => option.value === selectedValue) ?? null;
  const normalized = `${selectedValue ?? ""} ${selectedOption?.label ?? ""}`.toLowerCase();
  return !/\b(off|false|disabled|none)\b/.test(normalized);
}

function launchAgentModelOptionId(agentKind: string, modelId: string): string {
  return `${encodeURIComponent(agentKind)}:${encodeURIComponent(modelId)}`;
}

function parseLaunchAgentModelOptionId(
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

function buildSessionConfigComposerControl(input: {
  sessionId: string;
  control: NormalizedSessionControl;
  placement: "leading" | "trailing";
  pendingConfigChanges: Record<string, PendingConfigChange>;
  onSelect: (rawConfigId: string, value: string) => void;
}): CloudChatComposerControlView {
  const pendingChange =
    input.pendingConfigChanges[pendingConfigChangeKey(input.sessionId, input.control.rawConfigId)]
    ?? null;
  const selectedValue = pendingChange?.value ?? input.control.currentValue ?? null;
  const selectedOption = input.control.values.find((option) => option.value === selectedValue)
    ?? input.control.values[0]
    ?? null;
  return {
    id: input.control.rawConfigId,
    key: input.control.key,
    label: controlLabel(input.control),
    detail: selectedOption?.label ?? null,
    icon: controlIcon(input.control, input.placement),
    placement: input.placement,
    disabled: !input.control.settable,
    active: isActiveControl(input.control, selectedOption?.value ?? selectedValue),
    pendingState: pendingChange?.status ?? null,
    groups: [
      {
        id: input.control.rawConfigId,
        label: controlLabel(input.control),
        options: input.control.values.map((option) => ({
          id: option.value,
          label: option.label,
          description: option.description,
          selected: option.value === selectedValue,
          disabled: !input.control.settable || option.value === selectedValue,
        })),
      },
    ],
    onSelect: (value) => {
      if (value !== selectedValue) {
        input.onSelect(input.control.rawConfigId, value);
      }
    },
  };
}

function controlLabel(control: NormalizedSessionControl): string {
  return controlDisplayLabel(control.key, control.label);
}

function controlDisplayLabel(key: string, label: string): string {
  switch (key) {
    case "collaboration_mode":
      return "Mode";
    case "fast_mode":
      return "Fast mode";
    case "effort":
      return "Reasoning effort";
    case "model":
      return "Model";
    case "mode":
    case "reasoning":
      return label;
    default:
      return label || key;
  }
}

function controlIcon(
  control: NormalizedSessionControl,
  placement: "leading" | "trailing",
): CloudChatComposerControlView["icon"] {
  switch (control.key) {
    case "effort":
    case "reasoning":
      return "brain";
    case "model":
      return "bot";
    case "collaboration_mode":
    case "mode":
      return placement === "leading" ? "cloud" : "settings";
    default:
      return "settings";
  }
}

function isLeadingModeControl(control: NormalizedSessionControl): boolean {
  if (control.key !== "collaboration_mode" && control.key !== "mode") {
    return false;
  }
  return control.values.some((option) => {
    const normalized = `${option.value} ${option.label}`.toLowerCase();
    return normalized.includes("plan") || normalized.includes("agent") || normalized.includes("ask");
  });
}

function isActiveControl(
  control: NormalizedSessionControl,
  selectedValue: string | null | undefined,
): boolean {
  if (control.key !== "fast_mode" && control.key !== "reasoning") {
    return true;
  }

  const selectedOption = control.values.find((option) => option.value === selectedValue) ?? null;
  const normalized = `${selectedValue ?? ""} ${selectedOption?.label ?? ""}`.toLowerCase();
  return !/\b(off|false|disabled|none)\b/.test(normalized);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
