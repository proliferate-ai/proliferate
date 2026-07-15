import { useMemo } from "react";
import {
  reasoningLadderTopsOutAtUltra,
  resolveReasoningEffortEmphasis,
  resolveReasoningEffortPresentation,
  resolveReasoningEffortTierTone,
  type ReasoningEffortTierTone,
} from "#product/lib/domain/chat/session-controls/session-reasoning-effort-control";
import { resolveSessionControlTooltip } from "#product/lib/domain/chat/session-controls/session-toggle-control";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { LevelBarsButton } from "@proliferate/ui/primitives/LevelBarsButton";

// Tier-label tint ladder. Ultra keeps the codex-convention purple (same hue
// as --color-pr-merged); max keeps the app special blue the bars already use.
// Tinted tiers pin their color through hover (the control button's base
// `hover:text-current` would otherwise wash the tint back to plain ink);
// gray tiers keep the standard muted→full hover promotion.
const TIER_TONE_CLASSES: Readonly<Record<ReasoningEffortTierTone, string>> = {
  muted: "text-[color:var(--color-composer-control-muted-foreground)]",
  secondary: "text-foreground-secondary hover:!text-foreground",
  foreground: "text-foreground",
  special: "text-[color:var(--color-special)] hover:!text-[color:var(--color-special)]",
  ultra: "text-[color:var(--color-pr-merged)] hover:!text-[color:var(--color-pr-merged)]",
};

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
  // "X High") INSTEAD of the bars — the word plus its tier tint is the whole
  // signal; every other model keeps the compact icon-only bars.
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

  const stepToNext = () => {
    const nextIndex = (effectiveIndex + 1) % control.options.length;
    const nextValue = control.options[nextIndex]?.value;
    if (nextValue !== undefined) {
      control.onSelect(nextValue);
    }
  };

  const tierTone = resolveReasoningEffortTierTone(currentOption?.value ?? null);
  const bars = showsTierLabel
    ? (
      <ComposerControlButton
        label={currentLevel}
        onClick={stepToNext}
        disabled={!control.settable}
        title={tooltip}
        aria-label={ariaLabel}
        className={TIER_TONE_CLASSES[tierTone]}
        labelClassName="text-current"
        data-reasoning-effort-trigger=""
        data-reasoning-effort-selected={currentOption?.value ?? ""}
      />
    )
    : (
      <LevelBarsButton
        levels={levels}
        currentIndex={effectiveIndex}
        onStep={(nextValue: string) => control.onSelect(nextValue)}
        iconOnly
        emphasis={emphasis}
        disabled={!control.settable}
        title={tooltip}
        aria-label={ariaLabel}
        data-reasoning-effort-trigger=""
        data-reasoning-effort-selected={currentOption?.value ?? ""}
        levelOptionAttribute="data-reasoning-effort-option"
      />
    );

  return <Tooltip content={tooltip}>{bars}</Tooltip>;
}
