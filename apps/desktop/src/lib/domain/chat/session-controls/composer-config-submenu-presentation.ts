import {
  resolveSessionControlPresentation,
} from "@/lib/domain/chat/session-controls/session-mode-control";
import { resolveReasoningEffortPresentation } from "@/lib/domain/chat/session-controls/session-reasoning-effort-control";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";

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
