import type { ReactNode } from "react";
import { PopoverSearchField } from "./PopoverSearchField";

interface PickerPopoverContentProps {
  searchValue?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  emptyLabel?: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

export function PickerPopoverContent({
  searchValue,
  searchPlaceholder = "Search",
  onSearchChange,
  emptyLabel,
  className = "",
  bodyClassName = "",
  children,
}: PickerPopoverContentProps) {
  return (
    <div className={`flex max-h-80 min-h-0 flex-col ${className}`}>
      {onSearchChange ? (
        <PopoverSearchField
          value={searchValue ?? ""}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
        />
      ) : null}
      <div className={`min-h-0 overflow-y-auto py-1 ${bodyClassName}`}>
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
