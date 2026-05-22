import type {
  NormalizedSessionControl,
  SessionLiveConfigSnapshot,
} from "@anyharness/sdk";
import type { CloudSessionProjection } from "@proliferate/cloud-sdk";

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

export const DEFAULT_DIRECT_PROMPT_MODEL_ID = "gpt-5.4";

const CLOUD_MODEL_OPTIONS = [
  { id: "gpt-5.4", label: "GPT-5.4", description: "Balanced cloud work" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", description: "Fast lighter tasks" },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", description: "Coding-heavy work" },
] as const;

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
  launchModelId: string;
  onLaunchModelSelect: (modelId: string) => void;
  onSessionConfigSelect: (rawConfigId: string, value: string) => void;
}): CloudChatComposerControlView[] {
  if (!input.session) {
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
              selected: model.id === input.launchModelId,
            })),
          },
        ],
        onSelect: input.onLaunchModelSelect,
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
  switch (control.key) {
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
      return control.label;
    default:
      return control.label || control.key;
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
