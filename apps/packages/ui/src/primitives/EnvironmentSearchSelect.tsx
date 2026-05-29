import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Check, ChevronDown } from "../icons";
import { matchesPickerSearch } from "../utils/search";
import { Button } from "./Button";
import { PickerEmptyRow, PickerPopoverContent } from "./PickerPopoverContent";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "./PopoverButton";
import { PopoverMenuItem } from "./PopoverMenuItem";

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
          size="sm"
          disabled={disabled}
          className={`h-8 justify-between rounded-xl border-transparent bg-accent px-3 text-sm font-[430] leading-4 text-foreground shadow-none hover:bg-accent/80 data-[state=open]:bg-accent/80 ${className}`}
        >
          {leading}
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      )}
      className={`${menuClassName} ${POPOVER_SURFACE_CLASS}`}
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
              trailing={option.selected ? <Check className="size-3.5" /> : undefined}
              onClick={() => {
                option.onSelect();
                if (closeOnSelect) {
                  close();
                }
              }}
            >
              {option.detail ? (
                <span className="block truncate text-sm leading-4 text-muted-foreground">
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
