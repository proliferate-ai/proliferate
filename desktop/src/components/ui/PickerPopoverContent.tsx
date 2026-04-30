import type { ReactNode } from "react";
import { Input } from "@/components/ui/Input";
import { Search } from "@/components/ui/icons";

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
        <div className="border-b border-border/70 p-1 pb-2">
          <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-2.5">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <Input
              value={searchValue ?? ""}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 border-0 bg-transparent px-0 py-0 text-sm shadow-none focus:ring-0"
            />
          </div>
        </div>
      ) : null}
      <div className={`min-h-0 overflow-y-auto py-1 ${bodyClassName}`}>
        {children ?? (emptyLabel ? <PickerEmptyRow label={emptyLabel} /> : null)}
      </div>
    </div>
  );
}

export function PickerEmptyRow({ label }: { label: string }) {
  return (
    <div className="px-2.5 py-2 text-sm text-muted-foreground">
      {label}
    </div>
  );
}
