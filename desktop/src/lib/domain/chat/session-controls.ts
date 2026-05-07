import type {
  NormalizedSessionControl,
  NormalizedSessionControls,
  NormalizedSessionControlValue,
} from "@anyharness/sdk";
import {
  SESSION_CONTROL_ACCESSORS,
  SESSION_CONTROL_ORDER,
  type SupportedLiveControlKey,
} from "@/config/session-controls";
import { SESSION_CONTROL_LABELS } from "@/lib/domain/chat/session-controls/presentation";
import {
  resolveDisplayedSessionControlState,
  type PendingSessionConfigChangeStatus,
  type PendingSessionConfigChanges,
} from "@/lib/domain/sessions/pending-config";

export type { SupportedLiveControlKey } from "@/config/session-controls";

export interface LiveSessionControlOption {
  value: string;
  label: string;
  description?: string | null;
  selected: boolean;
}

export interface LiveSessionControlDescriptor {
  key: SupportedLiveControlKey;
  label: string;
  detail: string | null;
  rawConfigId: string;
  settable: boolean;
  pendingState: PendingSessionConfigChangeStatus | null;
  kind: "toggle" | "select";
  enabledValue?: string;
  disabledValue?: string;
  isEnabled?: boolean;
  options: LiveSessionControlOption[];
  onSelect: (value: string) => void;
}

export function buildLiveSessionControlDescriptors(
  normalized: NormalizedSessionControls | null | undefined,
  pendingConfigChanges: PendingSessionConfigChanges | null | undefined,
  onSelect: (rawConfigId: string, value: string) => void,
): LiveSessionControlDescriptor[] {
  if (!normalized) {
    return [];
  }

  const controls: LiveSessionControlDescriptor[] = [];

  for (const key of SESSION_CONTROL_ORDER) {
    const control = normalized[SESSION_CONTROL_ACCESSORS[key]];
    if (!control) {
      continue;
    }

    const displayedState = resolveDisplayedSessionControlState(control, pendingConfigChanges);
    const toggleState = resolveToggleState(control, displayedState.currentValue);
    const descriptorBase = {
      key,
      label: SESSION_CONTROL_LABELS[key],
      detail: currentValueLabel(control, displayedState.currentValue),
      rawConfigId: control.rawConfigId,
      settable: control.settable,
      pendingState: displayedState.pendingState,
      options: control.values.map((value: NormalizedSessionControlValue) => ({
        value: value.value,
        label: value.label,
        description: value.description,
        selected: value.value === displayedState.currentValue,
      })),
      onSelect: (value: string) => {
        void onSelect(control.rawConfigId, value);
      },
    };

    if (toggleState) {
      controls.push({
        ...descriptorBase,
        kind: "toggle",
        enabledValue: toggleState.enabledValue,
        disabledValue: toggleState.disabledValue,
        isEnabled: toggleState.isEnabled,
      });
      continue;
    }

    controls.push({
      ...descriptorBase,
      kind: "select",
    });
  }

  return controls;
}

export function mergeSessionConfigControlDescriptors(
  launchControls: LiveSessionControlDescriptor[],
  liveControls: LiveSessionControlDescriptor[],
): LiveSessionControlDescriptor[] {
  if (launchControls.length === 0) {
    return liveControls;
  }
  if (liveControls.length === 0) {
    return launchControls;
  }

  const liveControlsByKey = new Map(liveControls.map((control) => [control.key, control]));
  const launchKeys = new Set<SupportedLiveControlKey>();
  const merged = launchControls.map((launchControl) => {
    launchKeys.add(launchControl.key);
    const liveControl = liveControlsByKey.get(launchControl.key);
    if (!liveControl) {
      return launchControl;
    }

    return {
      ...launchControl,
      ...liveControl,
      key: launchControl.key,
      label: launchControl.label,
    };
  });

  for (const liveControl of liveControls) {
    if (!launchKeys.has(liveControl.key)) {
      merged.push(liveControl);
    }
  }

  return merged;
}

export function currentValueLabel(
  control: NormalizedSessionControl,
  currentValueOverride?: string | null,
): string | null {
  const currentValue = currentValueOverride ?? control.currentValue ?? null;
  const current = control.values.find((value) => value.value === currentValue);
  return current?.label ?? currentValue ?? null;
}

export function resolveToggleState(
  control: NormalizedSessionControl,
  currentValueOverride?: string | null,
): { enabledValue: string; disabledValue: string; isEnabled: boolean } | null {
  if (control.values.length !== 2) {
    return null;
  }

  const normalizedValues = control.values.map((value) => ({
    raw: value,
    tokens: valueTokens(value),
  }));
  const enabled = normalizedValues.find((value) => value.tokens.some(isEnabledToken));
  const disabled = normalizedValues.find((value) => value.tokens.some(isDisabledToken));
  if (!enabled || !disabled || enabled.raw.value === disabled.raw.value) {
    return null;
  }

  return {
    enabledValue: enabled.raw.value,
    disabledValue: disabled.raw.value,
    isEnabled: (currentValueOverride ?? control.currentValue) === enabled.raw.value,
  };
}

function valueTokens(value: NormalizedSessionControlValue): string[] {
  const raw = `${value.value} ${value.label}`.toLowerCase();
  return raw.split(/[^a-z0-9]+/).filter(Boolean);
}

function isEnabledToken(token: string): boolean {
  return token === "on"
    || token === "enabled"
    || token === "enable"
    || token === "true"
    || token === "yes";
}

function isDisabledToken(token: string): boolean {
  return token === "off"
    || token === "disabled"
    || token === "disable"
    || token === "false"
    || token === "no";
}
