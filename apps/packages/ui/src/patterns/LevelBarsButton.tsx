import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { motion } from "@proliferate/design/motion";
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

// Fill/drain/wrap stagger step: kept local (not a shared motion token) since
// it only paces the per-bar offset within a single ~150-250ms burst, not an
// interaction-scale duration/ease role.
const LEVEL_BAR_TRANSITION_STAGGER_MS = 40;

type LevelBarStepTransition =
  | { kind: "increase" | "decrease"; from: number; to: number }
  | { kind: "wrap" }
  | null;

/**
 * Tracks index changes on `currentIndex` and derives a one-shot transition
 * descriptor for the bars to animate: "increase"/"decrease" for a normal
 * step, or "wrap" when cycling rolls from the top level back to the bottom
 * one. Returns null (no animation) once the transition has played out, and
 * skips entirely under prefers-reduced-motion.
 */
function useLevelBarStepTransition(currentIndex: number, levelCount: number): LevelBarStepTransition {
  const [transition, setTransition] = useState<LevelBarStepTransition>(null);
  const prevIndexRef = useRef(currentIndex);

  useEffect(() => {
    const prev = prevIndexRef.current;
    prevIndexRef.current = currentIndex;
    if (prev === currentIndex) return;

    const reducedMotion = typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setTransition(null);
      return;
    }

    const isWrap = prev === levelCount - 1 && currentIndex === 0 && levelCount > 1;
    const next: LevelBarStepTransition = isWrap
      ? { kind: "wrap" }
      : { kind: currentIndex > prev ? "increase" : "decrease", from: prev, to: currentIndex };
    setTransition(next);

    // Matches the animation-duration of .composer-level-bar-fill-in/
    // -drain-out (--duration-hover) and .composer-level-bars-wrap
    // (--duration-disclosure) in product.css.
    const staggerSpan = isWrap ? 0 : Math.abs(currentIndex - prev) * LEVEL_BAR_TRANSITION_STAGGER_MS;
    const totalMs = isWrap ? motion.duration.disclosureMs : motion.duration.hoverMs + staggerSpan;
    const timer = window.setTimeout(() => setTransition(null), totalMs);
    return () => window.clearTimeout(timer);
  }, [currentIndex, levelCount]);

  return transition;
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
  const transition = useLevelBarStepTransition(currentIndex, barCount);

  const bars = Array.from({ length: barCount }, (_, i) => {
    const proportionalHeight = ((i + 1) / barCount) * 100;
    const lit = i <= currentIndex;
    const wave = lit && emphasis === "ultra";

    // Only bars whose lit state actually flips this step get the transition
    // class; the wave already keeps ultra bars in continuous motion, so it
    // takes priority over the one-shot fill/drain.
    let stepClass = "";
    let stepDelayMs: number | undefined;
    if (!wave && transition && transition.kind !== "wrap") {
      const { from, to } = transition;
      if (transition.kind === "increase" && i > from && i <= to) {
        stepClass = " composer-level-bar-fill-in";
        stepDelayMs = (i - from - 1) * LEVEL_BAR_TRANSITION_STAGGER_MS;
      } else if (transition.kind === "decrease" && i > to && i <= from) {
        stepClass = " composer-level-bar-drain-out";
        stepDelayMs = (from - i) * LEVEL_BAR_TRANSITION_STAGGER_MS;
      }
    }

    const optionAttr = levelOptionAttribute && levels[i]
      ? { [levelOptionAttribute]: levels[i]!.value }
      : undefined;

    return (
      <span
        key={i}
        {...optionAttr}
        className={`block shrink-0 rounded-full bg-current${wave ? " composer-level-bar-wave" : ""}${stepClass}`}
        style={{
          height: `${proportionalHeight}%`,
          minHeight: formatEm(LEVEL_BAR_MIN_HEIGHT_EM),
          width: barWidthEm,
          opacity: lit ? 1 : 0.3,
          animationDelay: wave ? `${i * 110}ms` : stepDelayMs !== undefined ? `${stepDelayMs}ms` : undefined,
        }}
      />
    );
  });

  const emphasisClass = emphasis === "ultra"
    ? "composer-level-bars-ultra"
    : emphasis === "max"
      ? "composer-level-bars-max"
      : "";
  const wrapClass = transition?.kind === "wrap" ? " composer-level-bars-wrap" : "";

  return (
    <span
      className={`icon-control inline-flex shrink-0 items-end justify-center ${emphasisClass}${wrapClass}`}
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
