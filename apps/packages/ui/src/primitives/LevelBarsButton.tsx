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
  const barWidth = 2;
  const barGap = 2;
  const viewBoxWidth = barCount * barWidth + (barCount - 1) * barGap;
  const viewBoxHeight = 15;

  const bars = Array.from({ length: barCount }, (_, i) => {
    const x = i * (barWidth + barGap);
    const height = Math.round(((i + 1) / barCount) * viewBoxHeight);
    const y = viewBoxHeight - height;
    const lit = i <= currentIndex;

    return (
      <rect
        key={i}
        x={x}
        y={y}
        width={barWidth}
        height={height}
        rx={1}
        fill="currentColor"
        opacity={lit ? 1 : 0.3}
        className={lit && emphasis === "ultra" ? "composer-level-bar-wave" : undefined}
        style={lit && emphasis === "ultra" ? { animationDelay: `${i * 110}ms` } : undefined}
      />
    );
  });

  const emphasisClass = emphasis === "ultra"
    ? "composer-level-bars-ultra"
    : emphasis === "max"
      ? "composer-level-bars-max"
      : "";

  return (
    <svg
      viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
      className={`size-3.5 ${emphasisClass}`}
      aria-hidden="true"
    >
      {bars}
    </svg>
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
