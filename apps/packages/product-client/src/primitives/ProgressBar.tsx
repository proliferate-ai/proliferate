import type { HTMLAttributes } from "react";

interface ProgressBarProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  indicatorClassName?: string;
  value: number;
}

export function ProgressBar({
  className = "",
  indicatorClassName = "",
  value,
  ...props
}: ProgressBarProps) {
  const clampedValue = Math.max(0, Math.min(100, value));

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clampedValue}
      className={className}
      {...props}
    >
      <div className={indicatorClassName} style={{ width: `${clampedValue}%` }} />
    </div>
  );
}
