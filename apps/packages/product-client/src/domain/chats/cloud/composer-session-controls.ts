import type {
  NormalizedSessionControl,
  SessionLiveConfigSnapshot,
} from "@anyharness/sdk";
import type {
  CloudAgentCatalogResponse,
  CloudSessionProjection,
} from "@proliferate/cloud-sdk";
import {
  inferSessionControlPresentation,
  isConfiguredSessionControlKey,
  resolveSessionControlPresentation,
  type ConfiguredSessionControlKey,
} from "../session-controls/presentation";
import {
  agentModelIcon,
  controlDisplayLabel,
  modelMatchesSelectedValue,
} from "./composer-control-identity";
import type {
  CloudChatComposerControlGroupView,
  CloudChatComposerControlView,
  CloudSessionAgentModelSelection,
  PendingConfigChange,
} from "./composer-control-model";
import { DEFAULT_DIRECT_PROMPT_AGENT_KIND } from "./composer-launch-defaults";
import {
  launchableCatalogAgents,
  parseLaunchAgentModelOptionId,
  visibleComposerModels,
} from "./composer-launch-catalog";

export function readSessionLiveConfig(
  session: CloudSessionProjection | null,
): SessionLiveConfigSnapshot | null {
  const liveConfig = session?.liveConfig;
  if (!isRecord(liveConfig) || !isRecord(liveConfig.normalizedControls)) {
    return null;
  }
  return liveConfig as unknown as SessionLiveConfigSnapshot;
}

export function buildCloudSessionComposerControls(input: {
  session: CloudSessionProjection;
  liveConfig: SessionLiveConfigSnapshot | null;
  pendingConfigChanges: Record<string, PendingConfigChange>;
  launchCatalog?: CloudAgentCatalogResponse | null;
  launchableAgentKinds?: readonly string[] | null;
  onSessionConfigSelect: (rawConfigId: string, value: string) => void;
  onSessionAgentModelSelect?: (selection: CloudSessionAgentModelSelection) => void;
}): CloudChatComposerControlView[] {
  const controls = collectNormalizedControls(input.liveConfig);
  const leadingModeControl = controls.find(isLeadingModeControl) ?? null;

  return controls.map((control) =>
    buildSessionConfigComposerControl({
      sessionId: input.session.sessionId,
      agentKind: input.session.sourceAgentKind ?? null,
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
        id: `${encodeURIComponent(agent.kind)}:${encodeURIComponent(model.id)}`,
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

function controlLabel(control: NormalizedSessionControl): string {
  return controlDisplayLabel(control.key, control.label);
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
