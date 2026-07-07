import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from "react";
import { ComposerControlButton } from "./ComposerControlButton";

interface Level {
  value: string;
  label: string;
}

interface LevelBarsButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  levels: Level[];
  currentIndex: number;
  onStep: (nextValue: string) => void;
}

function LevelBarsIcon({ levels, currentIndex }: { levels: Level[]; currentIndex: number }) {
  const barCount = levels.length;
  const barWidth = 2;
  const barGap = 2;
  const viewBoxWidth = barCount * barWidth + (barCount - 1) * barGap;
  const viewBoxHeight = 15;

  const bars = Array.from({ length: barCount }, (_, i) => {
    const x = i * (barWidth + barGap);
    const height = Math.round(((i + 1) / barCount) * viewBoxHeight);
    const y = viewBoxHeight - height;
    const opacity = i <= currentIndex ? 1 : 0.3;

    return (
      <rect
        key={i}
        x={x}
        y={y}
        width={barWidth}
        height={height}
        rx={1}
        fill="currentColor"
        opacity={opacity}
      />
    );
  });

  return (
    <svg
      viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
      className="size-[0.9375rem]"
      aria-hidden="true"
    >
      {bars}
    </svg>
  );
}

export const LevelBarsButton = forwardRef<HTMLButtonElement, LevelBarsButtonProps>(
  function LevelBarsButton({ levels, currentIndex, onStep, onClick, ...props }, ref) {
    const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
      const nextIndex = (currentIndex + 1) % levels.length;
      const nextValue = levels[nextIndex]?.value ?? levels[0]?.value;
      if (nextValue !== undefined) {
        onStep(nextValue);
      }
      onClick?.(e);
    };

    const currentLabel = levels[currentIndex]?.label ?? "";

    return (
      <ComposerControlButton
        ref={ref}
        icon={<LevelBarsIcon levels={levels} currentIndex={currentIndex} />}
        label={currentLabel}
        onClick={handleClick}
        {...props}
      />
    );
  },
);
