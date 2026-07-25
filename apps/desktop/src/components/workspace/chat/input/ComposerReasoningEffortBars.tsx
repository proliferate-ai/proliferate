import { useMemo } from "react";
import { resolveReasoningEffortPresentation } from "@/lib/domain/chat/session-controls/session-reasoning-effort-control";
import {
  isSessionControlUpdatePending,
  resolveSessionControlTooltip,
} from "@/lib/domain/chat/session-controls/session-control-tooltip";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import { LevelBarsButton } from "@proliferate/ui/primitives/LevelBarsButton";

interface ComposerReasoningEffortBarsProps {
  control: LiveSessionControlDescriptor;
}

export function ComposerReasoningEffortBars({ control }: ComposerReasoningEffortBarsProps) {
  const levels = useMemo(
    () => control.options.map((option) => ({ value: option.value, label: option.label })),
    [control.options],
  );

  const currentIndex = control.options.findIndex((option) => option.selected);
  const effectiveIndex = currentIndex >= 0 ? currentIndex : 0;

  const currentOption = control.options[effectiveIndex] ?? null;
  const currentPresentation = resolveReasoningEffortPresentation(
    currentOption?.value ?? null,
    currentOption?.label,
  );
  const currentLevel =
    currentPresentation.shortLabel ?? control.detail ?? control.label;
  const ariaLabel = `Reasoning: ${currentLevel}`;
  const tooltip = resolveSessionControlTooltip({
    label: "Reasoning",
    value: currentLevel,
    description: currentOption?.description ?? null,
    hint: control.settable ? "Click to cycle." : null,
    pendingState: control.pendingState,
  });

  return (
    <Tooltip content={tooltip}>
      <LevelBarsButton
        levels={levels}
        currentIndex={effectiveIndex}
        onStep={(nextValue: string) => control.onSelect(nextValue)}
        iconOnly
        disabled={!control.settable}
        aria-label={ariaLabel}
        aria-busy={isSessionControlUpdatePending(control.pendingState)}
      />
    </Tooltip>
  );
}
