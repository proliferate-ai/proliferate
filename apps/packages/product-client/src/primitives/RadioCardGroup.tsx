import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";
import { Check } from "#product/primitives/icons/core";

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
  const buttonRefs = useRef(new Map<Value, HTMLButtonElement>());

  // Roving tabindex: the selected enabled option is the tab stop, falling
  // back to the first enabled option otherwise. Arrow keys move selection
  // and focus together (WAI-ARIA selection-follows-focus).
  const enabledOptions = options.filter((option) => !option.disabled);
  const tabStopIndex = Math.max(
    enabledOptions.findIndex((option) => option.value === value),
    0,
  );
  const tabStopValue = enabledOptions[tabStopIndex]?.value;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A modified arrow belongs to whatever chord it's part of, not to us.
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;

    const forwardKey = horizontal ? "ArrowRight" : "ArrowDown";
    const backwardKey = horizontal ? "ArrowLeft" : "ArrowUp";
    const count = enabledOptions.length;

    let nextOption: RadioCardOption<Value> | undefined;
    if (event.key === forwardKey) {
      nextOption = enabledOptions[(tabStopIndex + 1) % count];
    } else if (event.key === backwardKey) {
      nextOption = enabledOptions[(tabStopIndex - 1 + count) % count];
    } else if (event.key === "Home") {
      nextOption = enabledOptions[0];
    } else if (event.key === "End") {
      nextOption = enabledOptions[count - 1];
    }

    if (nextOption) {
      event.preventDefault();
      onChange(nextOption.value);
      buttonRefs.current.get(nextOption.value)?.focus();
    }
  };

  return (
    <div
      role="radiogroup"
      aria-orientation={orientation}
      data-orientation={orientation}
      className={twMerge("flex gap-2", horizontal ? "flex-row flex-wrap" : "flex-col", className)}
      onKeyDown={handleKeyDown}
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              if (el) {
                buttonRefs.current.set(option.value, el);
              } else {
                buttonRefs.current.delete(option.value);
              }
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            tabIndex={option.value === tabStopValue ? 0 : -1}
            data-selected={selected ? "" : undefined}
            className={twMerge(
              "relative flex gap-2.5 rounded-lg border bg-background py-3 pl-[13px] pr-[34px] text-left transition-colors disabled:pointer-events-none disabled:opacity-50",
              horizontal ? "min-w-[150px] flex-1 flex-col" : "items-start",
              selected ? "border-special" : "border-input hover:bg-hover active:bg-active",
            )}
            onClick={() => onChange(option.value)}
          >
            {option.icon ? (
              <span
                className={twMerge(
                  "flex shrink-0 items-center [&_svg]:icon-paired",
                  selected ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {option.icon}
              </span>
            ) : null}
            <span className="min-w-0">
              <span className="block text-ui font-medium text-foreground">
                {option.label}
              </span>
              {option.description ? (
                <span className="mt-[3px] block text-ui-sm text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </span>
            <span
              className={twMerge(
                "absolute right-[11px] top-[11px] flex size-5 shrink-0 items-center justify-center rounded-full border text-ui transition-colors [&_svg]:icon-compact",
                selected ? "border-special bg-special text-background" : "border-input text-transparent",
              )}
            >
              {selected ? <Check className="icon-compact" strokeWidth={3} /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
