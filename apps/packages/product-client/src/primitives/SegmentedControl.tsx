import { type ReactNode } from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";

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
  /**
   * "bordered" (default) is the standalone control: outer border, per-item
   * dividers. "plain" drops the border chrome for use inside an
   * already-bordered host (e.g. a floating pill) — color/active states stay
   * identical, only the border/container treatment changes.
   */
  variant?: "bordered" | "plain";
}

export function SegmentedControl<Id extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className = "",
  variant = "bordered",
}: SegmentedControlProps<Id>) {
  const isPlain = variant === "plain";

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={twMerge(
        isPlain
          ? "inline-flex items-center gap-0.5 rounded-lg p-0.5"
          : "inline-flex overflow-hidden rounded-md border border-input",
        className,
      )}
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
              isPlain
                ? "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-ui-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 [&_svg]:icon-paired"
                : "inline-flex h-control items-center gap-1.5 border-l border-input px-3 text-ui font-medium transition-colors first:border-l-0 disabled:pointer-events-none disabled:opacity-50 [&_svg]:icon-paired",
              active
                ? "bg-selected text-foreground"
                : isPlain
                  ? "text-muted-foreground hover:bg-hover hover:text-foreground active:bg-active"
                  : "bg-background text-muted-foreground hover:bg-hover hover:text-foreground active:bg-active",
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
