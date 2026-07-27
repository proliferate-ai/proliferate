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
// the compositor instead.
//
// Geometry: the bar *stroke* is the invariant, not the total width. Every
// ladder draws the same weight of bar at the same gap, so a longer ladder
// simply reads as a wider icon instead of squeezing more hairlines into a
// fixed slot (which made 5- and 6-level ladders illegible). Height stays
// pinned to the semantic control-tier slot, so the icon still lines up with
// every other composer control; only the width tracks the level count.
const LEVEL_BAR_HEIGHT_EM = 4 / 3;
const LEVEL_BAR_GAP_EM = LEVEL_BAR_HEIGHT_EM / 16;
const LEVEL_BAR_WIDTH_EM = LEVEL_BAR_HEIGHT_EM / 4;
// A bar never draws shorter than it is wide: below that it stops reading as a
// bar and becomes a squashed stub.
const LEVEL_BAR_MIN_HEIGHT_EM = LEVEL_BAR_WIDTH_EM;

function formatEm(value: number): string {
  return `${Number(value.toFixed(6))}em`;
}

function resolveLevelBarGeometry(barCount: number): {
  barGapEm: string;
  barWidthEm: string;
  iconWidthEm: string;
} {
  const safeBarCount = Math.max(1, barCount);
  const barGap = safeBarCount <= 1 ? 0 : LEVEL_BAR_GAP_EM;
  return {
    barGapEm: formatEm(barGap),
    barWidthEm: formatEm(LEVEL_BAR_WIDTH_EM),
    iconWidthEm: formatEm(
      (safeBarCount * LEVEL_BAR_WIDTH_EM) + (Math.max(0, safeBarCount - 1) * barGap),
    ),
  };
}

// Fill/drain/wrap stagger step: kept local (not a shared motion token) since
// it only paces the per-bar offset within a single ~150-250ms burst, not an
// interaction-scale duration/ease role.
const LEVEL_BAR_TRANSITION_STAGGER_MS = 40;

// Per-bar offset of the continuous ultra "wave". Paced against the wave's own
// cycle (composer-level-bar-wave in product.css) rather than an interaction
// duration: it is ambient activity, so the travelling crest should read as one
// slow sweep across the ladder, not N bars pulsing near-together.
const LEVEL_BAR_WAVE_STAGGER_MS = 480;

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
    // -drain-out (--activity-level-bar-step) and .composer-level-bars-wrap
    // (--duration-disclosure) in product.css. Holding the class for the full
    // span matters more now that the step is a second long: clearing it early
    // would snap the bar to its final height mid-climb.
    const staggerSpan = isWrap ? 0 : Math.abs(currentIndex - prev) * LEVEL_BAR_TRANSITION_STAGGER_MS;
    const totalMs = isWrap
      ? motion.duration.disclosureMs
      : motion.activity.levelBarStepMs + staggerSpan;
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
  const { barGapEm, barWidthEm, iconWidthEm } = resolveLevelBarGeometry(barCount);
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

    // Two elements per bar, not one. The outer span is the bar's full-height
    // track and never animates, so the dim silhouette of the whole ladder stays
    // put; the inner span is the lit fill, and it is the only thing that grows
    // or drains. Scaling a single element instead (what this used to do) shrank
    // the bar itself, so at a duration long enough to watch, the bar visibly
    // disappeared and regrew rather than filling in place.
    return (
      <span
        key={i}
        {...optionAttr}
        className="relative block shrink-0 overflow-hidden rounded-full"
        style={{
          height: `${proportionalHeight}%`,
          minHeight: formatEm(LEVEL_BAR_MIN_HEIGHT_EM),
          width: barWidthEm,
        }}
      >
        {/* Sibling of the fill rather than its parent: as an ancestor its 30%
            would multiply into the fill's own alpha and mute the lit ink. */}
        <span className="absolute inset-0 rounded-full bg-current opacity-30" />
        {lit || stepClass ? (
          <span
            className={`absolute inset-0 origin-bottom rounded-full bg-current${wave ? " composer-level-bar-wave" : ""}${stepClass}`}
            style={{
              animationDelay: wave
                ? `${i * LEVEL_BAR_WAVE_STAGGER_MS}ms`
                : stepDelayMs !== undefined ? `${stepDelayMs}ms` : undefined,
            }}
          />
        ) : null}
      </span>
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
      // Height comes from the control-tier icon slot (icon-control); width is
      // overridden per ladder length so the bars keep their stroke instead of
      // being divided out of a fixed slot.
      style={{ gap: barGapEm, width: iconWidthEm }}
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
