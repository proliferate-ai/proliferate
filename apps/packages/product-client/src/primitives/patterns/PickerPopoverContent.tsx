import type { ReactNode } from "react";
import { PopoverSearchField } from "#product/primitives/PopoverSearchField";
import { twMerge } from "#product/primitives/utils/tw-merge";

interface PickerPopoverContentProps {
  searchValue?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  /** Accessible name for the search input when the placeholder is not descriptive enough. */
  searchAriaLabel?: string;
  /** Focus the search input when the picker opens. */
  searchAutoFocus?: boolean;
  emptyLabel?: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

export function PickerPopoverContent({
  searchValue,
  searchPlaceholder = "Search",
  onSearchChange,
  searchAriaLabel,
  searchAutoFocus,
  emptyLabel,
  className = "",
  bodyClassName = "",
  children,
}: PickerPopoverContentProps) {
  return (
    // twMerge, not concatenation: `max-h-80` is a default a caller may override
    // with a shorter cap, and a plain join leaves both utilities standing so
    // stylesheet order — not the caller — picks the winner.
    <div className={twMerge("flex max-h-80 min-h-0 flex-col", className)}>
      {onSearchChange ? (
        <PopoverSearchField
          value={searchValue ?? ""}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
          ariaLabel={searchAriaLabel}
          autoFocus={searchAutoFocus}
        />
      ) : null}
      <div className={twMerge("min-h-0 overflow-y-auto py-1", bodyClassName)}>
        {children ?? (emptyLabel ? <PickerEmptyRow label={emptyLabel} /> : null)}
      </div>
    </div>
  );
}

export function PickerEmptyRow({ label }: { label: string }) {
  return (
    <div className="px-2.5 py-[5px] text-ui text-muted-foreground">
      {label}
    </div>
  );
}
