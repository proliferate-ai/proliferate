import { useMemo } from "react";
import { resolveReasoningEffortPresentation } from "@/lib/domain/chat/session-controls/session-reasoning-effort-control";
import { resolveSessionControlTooltip } from "@/lib/domain/chat/session-controls/session-toggle-control";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import { LevelBarsButton } from "@proliferate/ui/primitives/LevelBarsButton";
import { PendingConfigIndicator } from "./PendingConfigIndicator";

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
  const tooltip = resolveSessionControlTooltip(
    control.label,
    currentPresentation.shortLabel ?? control.detail ?? control.label,
    currentOption?.description ?? null,
  ) + ". Click to step.";

  if (control.pendingState) {
    return (
      <Tooltip content={tooltip}>
        <span className="inline-flex items-center gap-1">
          <LevelBarsButton
            levels={levels}
            currentIndex={effectiveIndex}
            onStep={(nextValue: string) => control.onSelect(nextValue)}
            disabled={!control.settable}
            title={tooltip}
            aria-label={tooltip}
          />
          <PendingConfigIndicator pendingState={control.pendingState} />
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip content={tooltip}>
      <LevelBarsButton
        levels={levels}
        currentIndex={effectiveIndex}
        onStep={(nextValue: string) => control.onSelect(nextValue)}
        disabled={!control.settable}
        title={tooltip}
        aria-label={tooltip}
      />
    </Tooltip>
  );
}
