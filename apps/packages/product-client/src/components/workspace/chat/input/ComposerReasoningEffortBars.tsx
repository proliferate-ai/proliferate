import { useMemo } from "react";
import {
  reasoningLadderTopsOutAtUltra,
  resolveReasoningEffortPresentation,
  resolveReasoningEffortTierTone,
  type ReasoningEffortTierTone,
} from "#product/lib/domain/chat/session-controls/session-reasoning-effort-control";
import { resolveSessionControlTooltip } from "#product/lib/domain/chat/session-controls/session-toggle-control";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import { LevelBarsButton } from "@proliferate/ui/primitives/LevelBarsButton";
import { AnimatedSwapText } from "@proliferate/ui/primitives/AnimatedSwapText";

// Tier-label tint ladder for ultra-capable ladders. Ultra keeps the
// codex-convention purple (same hue as --color-pr-merged); max keeps the app
// special blue. Tinted tiers pin their color through hover (the control
// button's base `hover:text-current` would otherwise wash the tint back to
// plain ink); gray tiers keep the standard muted→full hover promotion.
const TIER_TONE_CLASSES: Readonly<Record<ReasoningEffortTierTone, string>> = {
  muted: "text-[color:var(--color-composer-control-muted-foreground)]",
  secondary: "text-foreground-secondary hover:!text-foreground",
  foreground: "text-foreground",
  special: "text-[color:var(--color-special)] hover:!text-[color:var(--color-special)]",
  ultra: "text-[color:var(--color-pr-merged)] hover:!text-[color:var(--color-pr-merged)]",
};

interface ComposerReasoningEffortBarsProps {
  control: LiveSessionControlDescriptor;
  agentKind?: string | null;
}

export function ComposerReasoningEffortBars({
  control,
  agentKind = null,
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
  // Every model shows bars + the level name. Tint is an ultra-ladder-only
  // affordance (frontier models): their upper tiers color the whole control;
  // plain ladders stay quiet even at max.
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
  // Codex frontier ladders (GPT Sol) trade the purple ultra tint for the
  // cooler blue→purple sweep; Claude ultra keeps flat purple.
  const isUltraTier = isUltraLadder && tierTone === "ultra";
  const isSolUltra = isUltraTier && agentKind === "codex";
  // Ultra "on" reads like the fast-mode zap when enabled: a filled purple
  // chip, not just tinted text. Pinned through hover so it doesn't wash back.
  const chipClass = isUltraTier ? "composer-reasoning-ultra-chip" : "";
  const toneClass = isUltraLadder ? TIER_TONE_CLASSES[tierTone] : "";

  const levelText = isSolUltra
    ? <span className="composer-reasoning-ultra-sol">{currentLevel}</span>
    : currentLevel;
  const labelNode = (
    <AnimatedSwapText
      valueKey={currentOption?.value ?? currentLevel}
      value={levelText}
    />
  );

  return (
    <Tooltip content={tooltip}>
      <LevelBarsButton
        levels={levels}
        currentIndex={effectiveIndex}
        onStep={(nextValue: string) => control.onSelect(nextValue)}
        label={labelNode}
        emphasis="none"
        className={`!gap-2 ${toneClass} ${chipClass}`}
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
