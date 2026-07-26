import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { ComposerControlButton } from "./ComposerControlButton";

interface Level {
  value: string;
  label: string;
}

export type LevelBarsEmphasis = "none" | "max" | "ultra";

interface LevelBarsButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  levels: Level[];
  currentIndex: number;
  onStep: (nextValue: string) => void;
  iconOnly?: boolean;
  emphasis?: LevelBarsEmphasis;
  /**
   * Optional `data-*` attribute name stamped on each level bar with that
   * level's value (e.g. `data-reasoning-effort-option`). Pure test/automation
   * labeling — it changes no rendering or behavior.
   */
  levelOptionAttribute?: string;
  /** Overrides the derived current-level label (e.g. to animate label swaps). */
  label?: ReactNode;
}

// HTML bars, not an inline SVG: WebKit does not compositor-accelerate
// transform/opacity animations on SVG child elements, so the staggered
// "wave" (see composer-level-bar-wave in product.css) used to force a
// repaint of the whole icon every frame. Plain <span> bars with
// currentColor backgrounds pick up the same scaleY/opacity keyframes on
// the compositor instead. Every ladder owns the semantic control-tier slot.
// All internal geometry is proportional to the owning text role: short
// ladders get heavier bars, while longer ladders stay inside the slot instead
// of consuming the icon-to-label gap.
const LEVEL_BAR_CONTAINER_EM = 4 / 3;
const LEVEL_BAR_GAP_EM = LEVEL_BAR_CONTAINER_EM / 16;
const LEVEL_BAR_MAX_WIDTH_EM = LEVEL_BAR_CONTAINER_EM / 4;
const LEVEL_BAR_MIN_HEIGHT_EM = LEVEL_BAR_CONTAINER_EM / 8;

function formatEm(value: number): string {
  return `${Number(value.toFixed(6))}em`;
}

function resolveLevelBarGeometry(barCount: number): { barGapEm: string; barWidthEm: string } {
  const safeBarCount = Math.max(1, barCount);
  const barGap = safeBarCount <= 1
    ? 0
    : Math.min(LEVEL_BAR_GAP_EM, LEVEL_BAR_CONTAINER_EM / (safeBarCount * 2));
  const availableWidth = LEVEL_BAR_CONTAINER_EM
    - (Math.max(0, safeBarCount - 1) * barGap);
  return {
    barGapEm: formatEm(barGap),
    barWidthEm: formatEm(Math.min(LEVEL_BAR_MAX_WIDTH_EM, availableWidth / safeBarCount)),
  };
}

function LevelBarsIcon({
  levels,
  currentIndex,
  emphasis = "none",
  levelOptionAttribute,
}: {
  levels: Level[];
  currentIndex: number;
  emphasis?: LevelBarsEmphasis;
  levelOptionAttribute?: string;
}) {
  const barCount = levels.length;
  const { barGapEm, barWidthEm } = resolveLevelBarGeometry(barCount);

  const bars = Array.from({ length: barCount }, (_, i) => {
    const proportionalHeight = ((i + 1) / barCount) * 100;
    const lit = i <= currentIndex;
    const wave = lit && emphasis === "ultra";
    const optionAttr = levelOptionAttribute && levels[i]
      ? { [levelOptionAttribute]: levels[i]!.value }
      : undefined;

    return (
      <span
        key={i}
        {...optionAttr}
        className={`block shrink-0 rounded-full bg-current${wave ? " composer-level-bar-wave" : ""}`}
        style={{
          height: `${proportionalHeight}%`,
          minHeight: formatEm(LEVEL_BAR_MIN_HEIGHT_EM),
          width: barWidthEm,
          opacity: lit ? 1 : 0.3,
          animationDelay: wave ? `${i * 110}ms` : undefined,
        }}
      />
    );
  });

  const emphasisClass = emphasis === "ultra"
    ? "composer-level-bars-ultra"
    : emphasis === "max"
      ? "composer-level-bars-max"
      : "";

  return (
    <span
      className={`icon-control inline-flex shrink-0 items-end justify-center ${emphasisClass}`}
      style={{ gap: barGapEm }}
      aria-hidden="true"
      data-level-bars-icon
      data-level-bars-count={barCount}
    >
      {bars}
    </span>
  );
}

export const LevelBarsButton = forwardRef<HTMLButtonElement, LevelBarsButtonProps>(
  function LevelBarsButton({
    levels,
    currentIndex,
    onStep,
    onClick,
    iconOnly = false,
    emphasis = "none",
    levelOptionAttribute,
    label,
    className = "",
    ...props
  }, ref) {
    const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
      const nextIndex = (currentIndex + 1) % levels.length;
      const nextValue = levels[nextIndex]?.value ?? levels[0]?.value;
      if (nextValue !== undefined) {
        onStep(nextValue);
      }
      onClick?.(e);
    };

    const currentLabel = levels[currentIndex]?.label ?? "";
    const emphasisButtonClass = emphasis === "ultra"
      ? "composer-level-bars-button-ultra"
      : emphasis === "max"
        ? "composer-level-bars-button-max"
        : "";

    return (
      <ComposerControlButton
        ref={ref}
        icon={(
          <LevelBarsIcon
            levels={levels}
            currentIndex={currentIndex}
            emphasis={emphasis}
            levelOptionAttribute={levelOptionAttribute}
          />
        )}
        iconOnly={iconOnly}
        label={label ?? currentLabel}
        onClick={handleClick}
        className={`${emphasisButtonClass} ${className}`}
        {...props}
      />
    );
  },
);
