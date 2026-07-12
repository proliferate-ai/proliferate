import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from "react";
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
}

// HTML bars, not an inline SVG: WebKit does not compositor-accelerate
// transform/opacity animations on SVG child elements, so the staggered
// "wave" (see composer-level-bar-wave in desktop.css) used to force a
// repaint of the whole icon every frame. Plain <span> bars with
// currentColor backgrounds pick up the same scaleY/opacity keyframes on
// the compositor instead. Geometry mirrors the old SVG rendering: 2px-wide
// pill bars (rx=1 on a 2px rect is effectively a full round-cap), 2px gaps,
// heights stepping up to the container's 14px (size-3.5) box, bottom-aligned
// and horizontally centered the way preserveAspectRatio="xMidYMid meet"
// centered the old viewBox.
const LEVEL_BAR_CONTAINER_PX = 14;

function LevelBarsIcon({
  levels,
  currentIndex,
  emphasis = "none",
}: {
  levels: Level[];
  currentIndex: number;
  emphasis?: LevelBarsEmphasis;
}) {
  const barCount = levels.length;

  const bars = Array.from({ length: barCount }, (_, i) => {
    const heightPx = Math.max(2, Math.round(((i + 1) / barCount) * LEVEL_BAR_CONTAINER_PX));
    const lit = i <= currentIndex;
    const wave = lit && emphasis === "ultra";

    return (
      <span
        key={i}
        className={`block w-[2px] shrink-0 rounded-full bg-current${wave ? " composer-level-bar-wave" : ""}`}
        style={{
          height: `${heightPx}px`,
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
      className={`inline-flex size-3.5 shrink-0 items-end justify-center gap-[2px] ${emphasisClass}`}
      aria-hidden="true"
      data-level-bars-icon
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
        icon={<LevelBarsIcon levels={levels} currentIndex={currentIndex} emphasis={emphasis} />}
        iconOnly={iconOnly}
        label={currentLabel}
        onClick={handleClick}
        className={`${emphasisButtonClass} ${className}`}
        {...props}
      />
    );
  },
);
