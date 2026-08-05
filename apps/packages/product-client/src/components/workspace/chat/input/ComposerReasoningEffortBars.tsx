import { useMemo } from "react";
import {
  reasoningLadderTopsOutAtUltra,
  resolveReasoningEffortPresentation,
  resolveReasoningEffortTierTone,
  type ReasoningEffortTierTone,
} from "#product/lib/domain/chat/session-controls/session-reasoning-effort-control";
import { resolveSessionControlTooltip } from "#product/lib/domain/chat/session-controls/session-toggle-control";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import { Tooltip } from "#product/primitives/Tooltip";
import { LevelBarsButton } from "#product/primitives/patterns/LevelBarsButton";

const TIER_TONE_CLASSES: Readonly<Record<ReasoningEffortTierTone, string>> = {
  muted: "text-composer-control-muted-foreground",
  secondary: "text-foreground-secondary hover:!text-foreground",
  foreground: "text-foreground",
  special: "text-special hover:!text-special",
  ultra: "text-pr-merged hover:!text-pr-merged",
};

interface ComposerReasoningEffortBarsProps {
  control: LiveSessionControlDescriptor;
}

export function ComposerReasoningEffortBars({
  control,
}: ComposerReasoningEffortBarsProps) {
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
  const isUltraLadder = reasoningLadderTopsOutAtUltra(control.options);

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

  const tierTone = resolveReasoningEffortTierTone(currentOption?.value ?? null);
  const isUltraTier = isUltraLadder && tierTone === "ultra";
  const chipClass = isUltraTier ? "composer-reasoning-ultra-chip" : "";
  const toneClass = isUltraLadder ? TIER_TONE_CLASSES[tierTone] : "";

  return (
    <Tooltip content={tooltip} keepOpenOnPress>
      <LevelBarsButton
        levels={levels}
        currentIndex={effectiveIndex}
        onStep={(nextValue: string) => control.onSelect(nextValue)}
        iconOnly
        emphasis="none"
        className={`${toneClass} ${chipClass}`}
        disabled={!control.settable}
        title={tooltip}
        aria-label={ariaLabel}
        data-reasoning-effort-trigger=""
        data-reasoning-effort-selected={currentOption?.value ?? ""}
        levelOptionAttribute="data-reasoning-effort-option"
      />
    </Tooltip>
  );
}
