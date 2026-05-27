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
import {
  inferSessionControlPresentation,
  isConfiguredSessionControlKey,
  launchControlToConfiguredSessionControlValues,
  resolveSessionControlPresentation,
  type ConfiguredSessionControlKey,
  type SessionControlIconKey,
} from "../session-controls/presentation";
import {
  DEFAULT_CLOUD_LAUNCHABLE_AGENT_KINDS,
  normalizeCloudAgentKindList,
} from "./harness-availability";

export { DEFAULT_CLOUD_LAUNCHABLE_AGENT_KINDS } from "./harness-availability";

export interface CloudChatComposerControlOptionView {
  id: string;
  label: string;
  description?: string | null;
  icon?: SessionControlIconKey | null;
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
  icon?: "bot" | "brain" | "settings" | SessionControlIconKey;
  placement?: "leading" | "trailing";
  disabled?: boolean;
  active?: boolean;
  pendingState?: "sending" | "queued" | null;
  groups: readonly CloudChatComposerControlGroupView[];
  onSelect?: (optionId: string) => void;
}

export interface CloudChatComposerBadgeSummary {
  label: string;
  icon?: CloudChatComposerControlView["icon"] | null;
  pending: boolean;
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

export interface CloudSessionAgentModelSelection {
  agentKind: string;
  modelId: string;
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
  launchableAgentKinds?: readonly string[] | null;
  launchSelection?: CloudLaunchComposerSelection;
  launchModelId: string;
  onLaunchAgentModelSelect?: (agentKind: string, modelId: string) => void;
  onLaunchControlSelect?: (selection: CloudLaunchComposerControlSelection) => void;
  onLaunchModelSelect: (modelId: string) => void;
  onSessionConfigSelect: (rawConfigId: string, value: string) => void;
  onSessionAgentModelSelect?: (selection: CloudSessionAgentModelSelection) => void;
}): CloudChatComposerControlView[] {
  if (!input.session) {
    return buildCloudLaunchComposerControls({
      catalog: input.launchCatalog,
      launchableAgentKinds: input.launchableAgentKinds,
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
      agentKind: input.session!.sourceAgentKind ?? null,
      control,
      catalog: input.launchCatalog ?? null,
      launchableAgentKinds: input.launchableAgentKinds,
      placement: control.rawConfigId === leadingModeControl?.rawConfigId ? "leading" : "trailing",
      pendingConfigChanges: input.pendingConfigChanges,
      onSelect: input.onSessionConfigSelect,
      onAgentModelSelect: input.onSessionAgentModelSelect,
    })
  );
}

export function buildCloudLaunchComposerControls(input: {
  catalog?: CloudAgentCatalogResponse | null;
  launchableAgentKinds?: readonly string[] | null;
  selection: CloudLaunchComposerSelection;
  onAgentModelSelect: (agentKind: string, modelId: string) => void;
  onControlSelect: (selection: CloudLaunchComposerControlSelection) => void;
}): CloudChatComposerControlView[] {
  const catalogAgents = launchableCatalogAgents({
    agents: input.catalog?.agents ?? [],
    launchableAgentKinds: input.launchableAgentKinds,
  });
  if (catalogAgents.length === 0) {
    if (shouldShowUnavailableLaunchControls({
      catalog: input.catalog,
      launchableAgentKinds: input.launchableAgentKinds,
    })) {
      return unavailableLaunchComposerControls();
    }
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
  launchableAgentKinds?: readonly string[] | null;
  selection: CloudLaunchComposerSelection;
}): CloudLaunchComposerSelection {
  const agents = launchableCatalogAgents({
    agents: input.catalog?.agents ?? [],
    launchableAgentKinds: input.launchableAgentKinds,
  });
  const agent = selectLaunchAgent(agents, input.selection.agentKind);
  if (!agent) {
    if (shouldShowUnavailableLaunchControls({
      catalog: input.catalog,
      launchableAgentKinds: input.launchableAgentKinds,
    })) {
      return {
        ...input.selection,
        agentKind: input.selection.agentKind || "",
        modelId: null,
        modeId: null,
      };
    }
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
  launchableAgentKinds?: readonly string[] | null;
  selection: CloudLaunchComposerSelection;
}): LaunchSessionConfigUpdate[] {
  const agent = selectLaunchAgent(
    launchableCatalogAgents({
      agents: input.catalog?.agents ?? [],
      launchableAgentKinds: input.launchableAgentKinds,
    }),
    input.selection.agentKind,
  );
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
  launchableAgentKinds?: readonly string[] | null;
  selection: CloudLaunchComposerSelection;
}): Record<string, string> {
  const agent = selectLaunchAgent(
    launchableCatalogAgents({
      agents: input.catalog?.agents ?? [],
      launchableAgentKinds: input.launchableAgentKinds,
    }),
    input.selection.agentKind,
  );
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

export function cloudComposerControlTitle(control: CloudChatComposerControlView): string {
  switch (control.key) {
    case "model":
      return "Model";
    case "mode":
    case "collaboration_mode":
      return "Mode";
    default:
      return control.label;
  }
}

export function selectedCloudComposerControlOption(
  control: CloudChatComposerControlView,
): CloudChatComposerControlOptionView | null {
  for (const group of control.groups) {
    const selected = group.options.find((option) => option.selected);
    if (selected) {
      return selected;
    }
  }
  return null;
}

export function formatCloudComposerControlValueLabel(
  control: CloudChatComposerControlView | null,
): string | null {
  if (!control) {
    return null;
  }
  const selected = selectedCloudComposerControlOption(control);
  const selectedLabel = selected ? normalizeCloudComposerModelLabel(selected.label) : null;
  const detail = control.detail?.trim();
  const value = detail && detail !== control.label && detail.toLowerCase() !== "mode"
    ? normalizeCloudComposerModelLabel(detail)
    : selectedLabel;
  if (!value) {
    return null;
  }
  return control.pendingState ? `Updating ${value}` : value;
}

export function normalizeCloudComposerModelLabel(label: string): string {
  return label
    .replace(/^Claude\s*·\s*/i, "")
    .replace(/^Claude\s+(?=Sonnet|Haiku|Opus)/i, "")
    .replace(/^OpenAI\s*·\s*/i, "")
    .replace(/^Gemini\s*·\s*/i, "")
    .replace(/^Codex\s*·\s*/i, "");
}

export function cloudComposerControlGroupLabel(
  control: CloudChatComposerControlView,
  group: CloudChatComposerControlGroupView,
): string | null {
  if (!group.label) {
    return null;
  }
  if (control.key !== "model" || group.label.toLowerCase() !== "models") {
    return group.label;
  }
  const providerIcon = group.options[0]?.icon;
  const everyOptionUsesSameProvider = providerIcon
    && group.options.every((option) => option.icon === providerIcon);
  if (!everyOptionUsesSameProvider) {
    return group.label;
  }
  switch (providerIcon) {
    case "claude":
      return "Claude";
    case "openai":
      return "OpenAI";
    case "gemini":
      return "Gemini";
    default:
      return group.label;
  }
}

export function summarizeCloudComposerBadgeControls(
  controls: readonly CloudChatComposerControlView[],
): CloudChatComposerBadgeSummary {
  const activeControls = controls.filter((control) => control.active !== false);
  const modelControl = activeControls.find((control) => control.key === "model") ?? null;
  const modeControl = activeControls.find((control) =>
    control.key === "mode" || control.key === "collaboration_mode"
  ) ?? activeControls.find((control) => control.placement === "leading") ?? null;
  const extras = activeControls.filter((control) =>
    control !== modelControl
    && control !== modeControl
    && (control.key === "reasoning" || control.key === "effort" || control.key === "fast_mode")
  );
  const primaryControl = modelControl ?? modeControl ?? activeControls[0] ?? null;
  const labels = [
    formatCloudComposerControlValueLabel(primaryControl) ?? primaryControl?.label ?? null,
    modeControl && modeControl !== primaryControl ? formatCloudComposerControlValueLabel(modeControl) : null,
    ...extras.map((control) => formatCloudComposerControlValueLabel(control)),
  ].filter((label): label is string => Boolean(label));

  return {
    label: labels.length > 0 ? labels.join(" · ") : "Chat settings",
    icon: primaryControl?.icon ?? null,
    pending: controls.some((control) => Boolean(control.pendingState)),
  };
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
      icon: "claude",
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
      icon: "sparkles",
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

function unavailableLaunchComposerControls(): CloudChatComposerControlView[] {
  return [
    {
      id: "launch-agent-unavailable",
      key: "model",
      label: "Agent",
      detail: "Unavailable",
      icon: "bot",
      placement: "trailing",
      disabled: true,
      active: false,
      groups: [
        {
          id: "agents",
          label: "Cloud agents",
          options: [
            {
              id: "unavailable",
              label: "No cloud agents ready",
              description: "Configure agent auth or managed credits before starting a session.",
              disabled: true,
              selected: true,
            },
          ],
        },
      ],
    },
    {
      id: "launch-mode-unavailable",
      key: "mode",
      label: "Cloud task",
      detail: "Waiting",
      icon: "sparkles",
      placement: "leading",
      disabled: true,
      active: false,
      groups: [
        {
          id: "mode",
          options: [
            {
              id: "cloud-task",
              label: "Cloud task",
              description: "Start a session in this workspace",
              selected: true,
              disabled: true,
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
  const selectedAgentIcon = agentModelIcon(input.selectedAgentKind);
  return {
    id: "launch-agent-model",
    key: "model",
    label: "Agent",
    icon: selectedAgentIcon,
    placement: "trailing",
    active: true,
    groups: input.agents.map((agent) => ({
      id: agent.kind,
      label: agent.displayName,
      options: visibleComposerModels({
        agent,
        selectedModelId: agent.kind === input.selectedAgentKind ? input.selectedModelId : null,
      }).map((model) => ({
        id: launchAgentModelOptionId(agent.kind, model.id),
        label: `${agent.displayName} · ${model.displayName}`,
        description: model.description ?? agent.description ?? null,
        icon: agentModelIcon(agent.kind),
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

function agentModelIcon(agentKind: string): SessionControlIconKey {
  switch (agentKind) {
    case "claude":
      return "claude";
    case "codex":
      return "openai";
    case "gemini":
      return "gemini";
    case "opencode":
      return "opencodeBuild";
    default:
      return "chat";
  }
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
  const configuredValues = launchControlToConfiguredSessionControlValues(input.agent.kind, input.control);
  const selectedConfiguredValue = configuredValues.find((option) => option.value === selectedValue) ?? null;
  const isConfiguredControl = isConfiguredSessionControlKey(input.control.key);
  return {
    id: `launch-control:${input.control.key}`,
    key: input.control.key,
    label: controlDisplayLabel(input.control.key, input.control.label),
    detail: selectedConfiguredValue?.shortLabel ?? selectedOption?.label ?? null,
    icon: selectedConfiguredValue?.icon ?? launchControlIcon(input.control, placement),
    placement,
    active: isLaunchControlActive(input.control, selectedOption?.value ?? selectedValue),
    groups: [
      {
        id: input.control.key,
        label: input.control.label,
        options: input.control.values
          .filter(isLaunchVisibleControlValue)
          .map((option) => {
            const configured = configuredValues.find((value) => value.value === option.value) ?? null;
            return {
              id: option.value,
              label: isConfiguredControl
                ? configured?.shortLabel ?? configured?.label ?? option.label
                : option.label,
              description: isConfiguredControl ? null : option.description ?? null,
              icon: configured?.icon ?? (isConfiguredControl
                ? inferSessionControlPresentation(option.value).icon
                : null),
              selected: option.value === selectedValue,
              disabled: option.value === selectedValue,
            };
          }),
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

function launchableCatalogAgents(input: {
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

function shouldShowUnavailableLaunchControls(input: {
  catalog?: CloudAgentCatalogResponse | null;
  launchableAgentKinds?: readonly string[] | null;
}): boolean {
  if (input.launchableAgentKinds !== undefined && input.launchableAgentKinds !== null) {
    return normalizeCloudAgentKindList(input.launchableAgentKinds).length === 0
      || Boolean(input.catalog?.agents?.length);
  }
  return Boolean(input.catalog?.agents?.length);
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

function visibleComposerModels(input: {
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
      return placement === "leading" ? "sparkles" : "settings";
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
  agentKind: string | null;
  control: NormalizedSessionControl;
  catalog?: CloudAgentCatalogResponse | null;
  launchableAgentKinds?: readonly string[] | null;
  placement: "leading" | "trailing";
  pendingConfigChanges: Record<string, PendingConfigChange>;
  onSelect: (rawConfigId: string, value: string) => void;
  onAgentModelSelect?: (selection: CloudSessionAgentModelSelection) => void;
}): CloudChatComposerControlView {
  const pendingChange =
    input.pendingConfigChanges[pendingConfigChangeKey(input.sessionId, input.control.rawConfigId)]
    ?? null;
  const selectedValue = pendingChange?.value ?? input.control.currentValue ?? null;
  const selectedOption = input.control.values.find((option) => option.value === selectedValue)
    ?? input.control.values[0]
    ?? null;
  const agentKind = input.agentKind
    ?? agentKindForSessionConfig(input.control)
    ?? (input.control.key === "model"
      ? agentKindForSessionModelValue({
        catalog: input.catalog ?? null,
        selectedLabel: selectedOption?.label ?? null,
        selectedValue,
      })
      : null);
  const controlKey = isConfiguredSessionControlKey(input.control.key) ? input.control.key : null;
  const selectedPresentation = controlKey
    ? resolveSessionControlPresentation(agentKind, controlKey, selectedValue)
    : null;
  const groups = input.control.key === "model"
    ? sessionModelGroupsFromCatalog({
      agentKind,
      catalog: input.catalog ?? null,
      launchableAgentKinds: input.launchableAgentKinds,
      selectedLabel: selectedOption?.label ?? null,
      selectedValue,
    }) ?? sessionControlGroups({
      agentKind,
      control: input.control,
      controlKey,
      selectedValue,
    })
    : sessionControlGroups({
      agentKind,
      control: input.control,
      controlKey,
      selectedValue,
    });

  return {
    id: input.control.rawConfigId,
    key: input.control.key,
    label: controlLabel(input.control),
    detail: selectedPresentation?.shortLabel ?? selectedOption?.label ?? null,
    icon: input.control.key === "model"
      ? agentModelIcon(agentKind ?? DEFAULT_DIRECT_PROMPT_AGENT_KIND)
      : selectedPresentation?.icon ?? controlIcon(input.control, input.placement),
    placement: input.placement,
    disabled: !input.control.settable,
    active: isActiveControl(input.control, selectedOption?.value ?? selectedValue),
    pendingState: pendingChange?.status ?? null,
    groups,
    onSelect: (value) => {
      const selectedModel = input.control.key === "model"
        ? parseLaunchAgentModelOptionId(value)
        : null;
      if (
        selectedModel
        && agentKind
        && selectedModel.agentKind !== agentKind
        && input.onAgentModelSelect
      ) {
        input.onAgentModelSelect(selectedModel);
        return;
      }
      const configValue = selectedModel?.modelId ?? value;
      if (configValue !== selectedValue) {
        input.onSelect(input.control.rawConfigId, configValue);
      }
    },
  };
}

function sessionControlGroups(input: {
  agentKind: string | null;
  control: NormalizedSessionControl;
  controlKey: ConfiguredSessionControlKey | null;
  selectedValue: string | null;
}): CloudChatComposerControlGroupView[] {
  return [
    {
      id: input.control.rawConfigId,
      label: controlLabel(input.control),
      options: input.control.values.map((option) => {
        const presentation = input.controlKey
          ? resolveSessionControlPresentation(input.agentKind, input.controlKey, option.value)
          : null;
        return {
          id: option.value,
          label: presentation?.shortLabel ?? option.label,
          description: input.controlKey ? null : option.description,
          icon: presentation?.icon ?? (input.controlKey
            ? inferSessionControlPresentation(option.value).icon
            : null),
          selected: option.value === input.selectedValue,
          disabled: !input.control.settable || option.value === input.selectedValue,
        };
      }),
    },
  ];
}

function sessionModelGroupsFromCatalog(input: {
  agentKind: string | null;
  catalog: CloudAgentCatalogResponse | null;
  launchableAgentKinds?: readonly string[] | null;
  selectedLabel: string | null;
  selectedValue: string | null;
}): CloudChatComposerControlGroupView[] | null {
  const agents = launchableCatalogAgents({
    agents: input.catalog?.agents ?? [],
    launchableAgentKinds: input.launchableAgentKinds,
    includeAgentKind: input.agentKind,
  });
  const groups = agents.flatMap((agent) => {
    const options = visibleComposerModels({
      agent,
      selectedLabel: agent.kind === input.agentKind ? input.selectedLabel : null,
      selectedValue: agent.kind === input.agentKind ? input.selectedValue : null,
    })
      .map((model) => ({
        id: launchAgentModelOptionId(agent.kind, model.id),
        label: model.displayName,
        description: model.description ?? null,
        icon: agentModelIcon(agent.kind),
        selected: agent.kind === input.agentKind && modelMatchesSelectedValue({
          displayName: model.displayName,
          id: model.id,
          selectedLabel: input.selectedLabel,
          selectedValue: input.selectedValue,
        }),
      }));
    return options.length > 0
      ? [{
        id: agent.kind,
        label: agent.displayName,
        options,
      }]
      : [];
  });

  return groups.length > 0 ? groups : null;
}

function modelMatchesSelectedValue(input: {
  displayName: string;
  id: string;
  selectedLabel: string | null;
  selectedValue: string | null;
}): boolean {
  const selectedCandidates = [
    input.selectedValue,
    input.selectedLabel,
  ].filter((value): value is string => Boolean(value));
  return selectedCandidates.some((candidate) => {
    if (candidate === input.id || candidate === input.displayName) {
      return true;
    }
    const normalizedCandidate = normalizeModelIdentity(candidate);
    const normalizedId = normalizeModelIdentity(input.id);
    const normalizedDisplay = normalizeModelIdentity(input.displayName);
    return normalizedCandidate === normalizedId
      || normalizedCandidate === normalizedDisplay
      || normalizedCandidate.includes(normalizedDisplay)
      || normalizedDisplay.includes(normalizedCandidate)
      || normalizedId.includes(normalizedCandidate);
  });
}

function normalizeModelIdentity(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(us|anthropic|claude|model|id)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
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
      return "claude";
    case "collaboration_mode":
    case "mode":
      return placement === "leading" ? "sparkles" : "settings";
    default:
      return "settings";
  }
}

function agentKindForSessionConfig(control: NormalizedSessionControl): string | null {
  const source = control.rawConfigId || control.key;
  const separator = source.indexOf(".");
  return separator > 0 ? source.slice(0, separator) : null;
}

function agentKindForSessionModelValue(input: {
  catalog: CloudAgentCatalogResponse | null;
  selectedLabel: string | null;
  selectedValue: string | null;
}): string | null {
  const selectedValue = input.selectedValue?.trim().toLowerCase() ?? "";
  const selectedLabel = input.selectedLabel?.trim().toLowerCase() ?? "";
  if (!selectedValue && !selectedLabel) {
    return null;
  }
  for (const agent of input.catalog?.agents ?? []) {
    if (
      agent.session.models.some((model) =>
        model.id.toLowerCase() === selectedValue
        || model.displayName.toLowerCase() === selectedLabel
      )
    ) {
      return agent.kind;
    }
  }
  return null;
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
