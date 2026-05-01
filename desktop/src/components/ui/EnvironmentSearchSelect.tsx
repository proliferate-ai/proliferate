import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { PickerEmptyRow, PickerPopoverContent } from "@/components/ui/PickerPopoverContent";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { Check, ChevronUpDown } from "@/components/ui/icons";
import { matchesPickerSearch } from "@/lib/infra/search";

export interface EnvironmentSearchSelectOption {
  id: string;
  label: string;
  detail?: string | null;
  selected?: boolean;
  disabled?: boolean;
  searchValues?: string[];
  onSelect: () => void;
}

interface EnvironmentSearchSelectProps {
  label: string;
  options: EnvironmentSearchSelectOption[];
  searchPlaceholder: string;
  emptyLabel: string;
  className?: string;
  menuClassName?: string;
  closeOnSelect?: boolean;
  leading?: ReactNode;
  disabled?: boolean;
}

export function EnvironmentSearchSelect({
  label,
  options,
  searchPlaceholder,
  emptyLabel,
  className = "w-64",
  menuClassName = "w-72",
  closeOnSelect = true,
  leading,
  disabled = false,
}: EnvironmentSearchSelectProps) {
  const [searchValue, setSearchValue] = useState("");
  const filteredOptions = useMemo(() => (
    options.filter((option) => matchesPickerSearch(
      [option.label, option.detail ?? "", ...(option.searchValues ?? [])],
      searchValue,
    ))
  ), [options, searchValue]);

  return (
    <PopoverButton
      align="start"
      trigger={(
        <Button
          type="button"
          variant="outline"
          size="md"
          disabled={disabled}
          className={`justify-between bg-background px-2.5 text-foreground shadow-none hover:bg-accent/50 ${className}`}
        >
          {leading}
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronUpDown className="size-3 shrink-0 text-muted-foreground" />
        </Button>
      )}
      className={`${menuClassName} rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-floating`}
    >
      {(close) => (
        <PickerPopoverContent
          searchValue={searchValue}
          searchPlaceholder={searchPlaceholder}
          onSearchChange={setSearchValue}
          emptyLabel={emptyLabel}
          bodyClassName="py-1"
        >
          {filteredOptions.length === 0 ? (
            <PickerEmptyRow label={emptyLabel} />
          ) : filteredOptions.map((option) => (
            <PopoverMenuItem
              key={option.id}
              label={option.label}
              disabled={option.disabled}
              className={option.selected ? "text-foreground" : "text-muted-foreground"}
              trailing={option.selected ? <Check className="size-3.5" /> : undefined}
              onClick={() => {
                option.onSelect();
                if (closeOnSelect) {
                  close();
                }
              }}
            >
              {option.detail ? (
                <span className="truncate text-xs text-muted-foreground">
                  {option.detail}
                </span>
              ) : null}
            </PopoverMenuItem>
          ))}
        </PickerPopoverContent>
      )}
    </PopoverButton>
  );
}
