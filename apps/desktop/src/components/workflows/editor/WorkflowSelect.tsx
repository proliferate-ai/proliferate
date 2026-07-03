import type { ReactNode } from "react";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { Check, ChevronDown } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";

export interface WorkflowSelectOption {
  value: string;
  label: ReactNode;
  /** Short text used on the trigger when this option is selected. */
  triggerLabel?: string;
  disabled?: boolean;
  icon?: ReactNode;
}

export interface WorkflowSelectProps {
  value: string;
  options: WorkflowSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  /** "field" — full-width form field. "chip" — compact quiet pill (rail card). */
  variant?: "field" | "chip";
  /** Trigger sizing/width override (e.g. `w-40`, `w-28`). */
  className?: string;
  /** Popover surface width. Default `w-52`. */
  menuWidthClassName?: string;
  align?: "start" | "end";
  disabled?: boolean;
}

/**
 * The product popover picker used everywhere a native `<select>` used to live in
 * the workflows UI. Renders `PopoverButton` + `PickerPopoverContent`-family so
 * the menu is our own surface (no macOS native menu) with consistent keyboard
 * behaviour and check-marked selection.
 */
export function WorkflowSelect({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "Select",
  variant = "field",
  className = "",
  menuWidthClassName = "w-52",
  align = "start",
  disabled = false,
}: WorkflowSelectProps) {
  const selected = options.find((option) => option.value === value);
  const triggerText = selected?.triggerLabel
    ?? (typeof selected?.label === "string" ? selected.label : undefined)
    ?? placeholder;

  const trigger =
    variant === "chip" ? (
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        aria-label={ariaLabel}
        disabled={disabled}
        className={twMerge(
          "flex h-6 select-none items-center gap-1 rounded-full bg-surface-elevated-secondary px-2 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground data-[state=open]:text-foreground disabled:opacity-50",
          className,
        )}
      >
        {selected?.icon ? <span className="inline-flex shrink-0 items-center">{selected.icon}</span> : null}
        <span className="min-w-0 truncate">{triggerText}</span>
        <ChevronDown className="size-3 shrink-0 text-faint" />
      </Button>
    ) : (
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        aria-label={ariaLabel}
        disabled={disabled}
        className={twMerge(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-surface-elevated-secondary px-3 text-sm text-foreground outline-none transition-colors hover:border-border-heavy focus:outline-none focus:border-border-heavy focus:ring-1 focus:ring-ring data-[state=open]:border-border-heavy disabled:opacity-60",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {selected?.icon ? <span className="inline-flex shrink-0 items-center">{selected.icon}</span> : null}
          <span className="min-w-0 truncate">{triggerText}</span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </Button>
    );

  return (
    <PopoverButton
      stopPropagation
      align={align}
      side="bottom"
      className={`${menuWidthClassName} ${POPOVER_SURFACE_CLASS}`}
      trigger={trigger}
    >
      {(close) => (
        <div className="p-1">
          {options.map((option) => (
            <PopoverMenuItem
              key={option.value}
              density="compact"
              icon={option.icon}
              label={option.label}
              disabled={option.disabled}
              trailing={option.value === value ? <Check className="size-3.5" /> : null}
              onClick={() => {
                if (option.value !== value) {
                  onChange(option.value);
                }
                close();
              }}
            />
          ))}
        </div>
      )}
    </PopoverButton>
  );
}
