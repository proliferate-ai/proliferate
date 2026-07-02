import { type ReactNode } from "react";
import { twMerge } from "../utils/tw-merge";

export interface SegmentedControlItem<Id extends string = string> {
  id: Id;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

interface SegmentedControlProps<Id extends string> {
  items: readonly SegmentedControlItem<Id>[];
  value: Id;
  onChange: (id: Id) => void;
  ariaLabel?: string;
  className?: string;
}

export function SegmentedControl<Id extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className = "",
}: SegmentedControlProps<Id>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={twMerge("inline-flex overflow-hidden rounded-md border border-input", className)}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={item.disabled}
            data-active={active ? "" : undefined}
            className={twMerge(
              "inline-flex h-[30px] items-center gap-1.5 border-l border-input px-3 text-xs font-medium transition-colors first:border-l-0 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[13px]",
              active
                ? "bg-foreground/10 text-foreground"
                : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            onClick={() => onChange(item.id)}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
