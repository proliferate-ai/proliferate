import type { ReactNode } from "react";
import { ComposerControlButton } from "@/components/workspace/chat/input/ComposerControlButton";
import { Input } from "@/components/ui/Input";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { Search } from "@/components/ui/icons";

export function matchesHomePickerSearch(values: string[], search: string): boolean {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }

  return values.some((value) => value.toLowerCase().includes(normalizedSearch));
}

interface HomePickerControlProps {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  controlClassName?: string;
  popoverClassName?: string;
  searchValue?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  children: (close: () => void) => ReactNode;
}

export function HomePickerControl({
  icon,
  label,
  disabled = false,
  controlClassName = "max-w-[12rem]",
  popoverClassName = "w-72 rounded-xl border border-border bg-popover p-1 shadow-floating",
  searchValue,
  searchPlaceholder = "Search",
  onSearchChange,
  children,
}: HomePickerControlProps) {
  if (disabled) {
    return (
      <ComposerControlButton
        disabled
        tone="quiet"
        icon={icon}
        label={label}
        className={controlClassName}
      />
    );
  }

  return (
    <PopoverButton
      trigger={(
        <ComposerControlButton
          icon={icon}
          label={label}
          className={controlClassName}
        />
      )}
      side="top"
      className={popoverClassName}
    >
      {(close) => (
        <div className="flex max-h-80 min-h-0 flex-col">
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
          <div className="min-h-0 overflow-y-auto py-1">
            {children(close)}
          </div>
        </div>
      )}
    </PopoverButton>
  );
}

export function HomeEmptyPickerRow({ label }: { label: string }) {
  return (
    <div className="px-2.5 py-2 text-sm text-muted-foreground">
      {label}
    </div>
  );
}
