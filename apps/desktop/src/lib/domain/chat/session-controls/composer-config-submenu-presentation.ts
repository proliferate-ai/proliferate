import {
  resolveConfiguredSessionControlValue,
  resolveSessionControlPresentation,
} from "@/lib/domain/chat/session-controls/session-mode-control";
import { resolveReasoningEffortPresentation } from "@/lib/domain/chat/session-controls/session-reasoning-effort-control";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";

export function sortComposerConfigSubmenuControls(
  controls: LiveSessionControlDescriptor[],
): LiveSessionControlDescriptor[] {
  const order: Partial<Record<LiveSessionControlDescriptor["key"], number>> = {
    effort: 0,
    reasoning: 1,
    fast_mode: 2,
    mode: 3,
    collaboration_mode: 4,
  };

  return [...controls].sort((left, right) => {
    const leftOrder = order[left.key] ?? 99;
    const rightOrder = order[right.key] ?? 99;
    return leftOrder - rightOrder;
  });
}

export function resolveComposerControlSubmenuLabel(
  control: LiveSessionControlDescriptor,
): string {
  if (control.key === "effort" || control.key === "reasoning") {
    return "Reasoning";
  }
  if (control.key === "fast_mode") {
    return "Speed";
  }
  return control.label;
}

export function resolveComposerControlOptionLabel(
  agentKind: string | null,
  control: LiveSessionControlDescriptor,
  optionValue: string,
  optionLabel: string,
): string {
  if (control.key === "fast_mode") {
    if (optionValue === control.enabledValue) {
      return "Fast";
    }
    if (optionValue === control.disabledValue) {
      return "Standard";
    }
  }

  if (control.key === "effort") {
    return resolveReasoningEffortPresentation(optionValue, optionLabel).shortLabel ?? optionLabel;
  }

  if (control.key === "mode" || control.key === "collaboration_mode") {
    return resolveSessionControlPresentation(agentKind, control.key, optionValue).shortLabel ?? optionLabel;
  }

  return optionLabel;
}

export function resolveComposerControlOptionDescription(
  agentKind: string | null,
  control: LiveSessionControlDescriptor,
  optionValue: string,
  optionDescription?: string | null,
): string | null {
  if (control.key === "fast_mode") {
    if (optionValue === control.enabledValue) {
      return "1.5x speed, increased plan usage";
    }
    if (optionValue === control.disabledValue) {
      return "Default speed";
    }
  }

  if (control.key === "mode" || control.key === "collaboration_mode") {
    return resolveConfiguredSessionControlValue(agentKind, control.key, optionValue)?.description
      ?? shortenRuntimeDescription(optionDescription);
  }

  if (optionDescription) {
    return shortenRuntimeDescription(optionDescription);
  }

  return null;
}

function shortenRuntimeDescription(description?: string | null): string | null {
  const trimmed = description?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.length > 92 ? `${trimmed.slice(0, 89).trimEnd()}...` : trimmed;
}
