import { useMemo } from "react";
import {
  reasoningLadderTopsOutAtUltra,
  resolveReasoningEffortEmphasis,
  resolveReasoningEffortPresentation,
} from "@/lib/domain/chat/session-controls/session-reasoning-effort-control";
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
    () => control.options.map((option) => ({
      value: option.value,
      label: resolveReasoningEffortPresentation(option.value, option.label).shortLabel
        ?? option.label,
    })),
    [control.options],
  );

  const currentIndex = control.options.findIndex((option) => option.selected);
  const effectiveIndex = currentIndex >= 0 ? currentIndex : 0;
  const emphasis = resolveReasoningEffortEmphasis(control.options);
  // Ultra-capable ladders name their tier in the chip ("Ultra" / "Max" /
  // "X High"); every other model keeps the compact icon-only bars.
  const showsTierLabel = reasoningLadderTopsOutAtUltra(control.options);

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

  const bars = (
    <LevelBarsButton
      levels={levels}
      currentIndex={effectiveIndex}
      onStep={(nextValue: string) => control.onSelect(nextValue)}
      iconOnly={!showsTierLabel}
      emphasis={emphasis}
      disabled={!control.settable}
      title={tooltip}
      aria-label={ariaLabel}
    />
  );

  if (control.pendingState) {
    return (
      <Tooltip content={tooltip}>
        <span className="inline-flex items-center gap-1">
          {bars}
          <PendingConfigIndicator pendingState={control.pendingState} />
        </span>
      </Tooltip>
    );
  }

  return <Tooltip content={tooltip}>{bars}</Tooltip>;
}
