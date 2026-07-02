import type { ReactNode } from "react";
import { twMerge } from "../utils/tw-merge";

export interface SegmentedControlOption<Value extends string = string> {
  value: Value;
  label: string;
  icon?: ReactNode;
}

/**
 * Exclusive 2–4 option switch (design-system SegmentedControl, CONTRACT §5):
 * one bordered frame, hairline dividers, active segment on the foreground-mix
 * fill (the app's `--accent-strong` equivalent — there is no such token).
 */
export function SegmentedControl<Value extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className = "",
}: {
  value: Value;
  options: readonly SegmentedControlOption<Value>[];
  onChange: (value: Value) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={twMerge("inline-flex overflow-hidden rounded-md border border-input", className)}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={twMerge(
              "inline-flex h-[30px] cursor-pointer items-center gap-1.5 px-2.5 text-ui-sm font-medium transition-colors [&>svg]:size-[13px]",
              index > 0 && "border-l border-input",
              active
                ? "bg-foreground/10 text-foreground"
                : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
