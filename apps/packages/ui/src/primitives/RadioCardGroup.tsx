import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { Check } from "../icons/core";

export interface RadioCardOption<Value extends string = string> {
  value: Value;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

interface RadioCardGroupProps<Value extends string> {
  value: Value | null;
  options: readonly RadioCardOption<Value>[];
  onChange: (value: Value) => void;
  orientation?: "horizontal" | "vertical";
  className?: string;
}

export function RadioCardGroup<Value extends string>({
  value,
  options,
  onChange,
  orientation = "horizontal",
  className = "",
}: RadioCardGroupProps<Value>) {
  const horizontal = orientation === "horizontal";
  return (
    <div
      role="radiogroup"
      data-orientation={orientation}
      className={twMerge("flex gap-2", horizontal ? "flex-row flex-wrap" : "flex-col", className)}
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            data-selected={selected ? "" : undefined}
            className={twMerge(
              "relative flex gap-2.5 rounded-lg border bg-background py-3 pl-[13px] pr-[34px] text-left transition-colors disabled:pointer-events-none disabled:opacity-50",
              horizontal ? "min-w-[150px] flex-1 flex-col" : "items-start",
              selected ? "border-special" : "border-input hover:bg-accent",
            )}
            onClick={() => onChange(option.value)}
          >
            {option.icon ? (
              <span
                className={twMerge(
                  "flex shrink-0 items-center [&_svg]:size-4",
                  selected ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {option.icon}
              </span>
            ) : null}
            <span className="min-w-0">
              <span className="block text-[13px] font-medium leading-[1.3] text-foreground">
                {option.label}
              </span>
              {option.description ? (
                <span className="mt-[3px] block text-[12px] leading-[1.45] text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </span>
            <span
              className={twMerge(
                "absolute right-[11px] top-[11px] flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors",
                selected ? "border-special bg-special text-background" : "border-input text-transparent",
              )}
            >
              {selected ? <Check className="size-3" strokeWidth={3} /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
