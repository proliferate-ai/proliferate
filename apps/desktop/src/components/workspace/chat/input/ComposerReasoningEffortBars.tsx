import { useMemo } from "react";
import { resolveReasoningEffortPresentation } from "@/lib/domain/chat/session-controls/session-reasoning-effort-control";
import { resolveSessionControlTooltip } from "@/lib/domain/chat/session-controls/session-toggle-control";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import { LevelBarsButton, type LevelBarsEmphasis } from "@proliferate/ui/primitives/LevelBarsButton";
import { PendingConfigIndicator } from "./PendingConfigIndicator";

interface ComposerReasoningEffortBarsProps {
  control: LiveSessionControlDescriptor;
}

// "max" — the session sits at the top reasoning level its model offers.
// "ultra" — that top level is the ultra tier, which only frontier models
// expose, so ultra-at-max doubles as the "top model at full capacity" signal.
function resolveEmphasis(
  options: LiveSessionControlDescriptor["options"],
  effectiveIndex: number,
): LevelBarsEmphasis {
  if (options.length < 2 || effectiveIndex !== options.length - 1) {
    return "none";
  }
  const topValue = options[effectiveIndex]?.value.toLowerCase() ?? "";
  return topValue === "ultra" ? "ultra" : "max";
}

export function ComposerReasoningEffortBars({ control }: ComposerReasoningEffortBarsProps) {
  const levels = useMemo(
    () => control.options.map((option) => ({ value: option.value, label: option.label })),
    [control.options],
  );

  const currentIndex = control.options.findIndex((option) => option.selected);
  const effectiveIndex = currentIndex >= 0 ? currentIndex : 0;
  const emphasis = resolveEmphasis(control.options, effectiveIndex);

  const currentOption = control.options[effectiveIndex] ?? null;
  const currentPresentation = resolveReasoningEffortPresentation(
    currentOption?.value ?? null,
    currentOption?.label,
  );
  const currentLevel =
    currentPresentation.shortLabel ?? control.detail ?? control.label;
  const ariaLabel = `Reasoning: ${currentLevel}`;
  const tooltip = resolveSessionControlTooltip(
    "Reasoning",
    currentLevel,
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
            iconOnly
            emphasis={emphasis}
            disabled={!control.settable}
            title={tooltip}
            aria-label={ariaLabel}
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
        iconOnly
        emphasis={emphasis}
        disabled={!control.settable}
        title={tooltip}
        aria-label={ariaLabel}
      />
    </Tooltip>
  );
}
