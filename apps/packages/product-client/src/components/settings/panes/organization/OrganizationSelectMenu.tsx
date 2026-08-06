import { Check, ChevronDown } from "#product/primitives/icons/core";
import { Button } from "#product/primitives/Button";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "#product/primitives/PopoverButton";
import { PopoverMenuItem } from "#product/primitives/PopoverMenuItem";

export interface OrganizationSelectMenuOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function OrganizationSelectMenu({
  value,
  options,
  ariaLabel,
  className = "",
  onChange,
}: {
  value: string;
  options: OrganizationSelectMenuOption[];
  ariaLabel: string;
  className?: string;
  onChange: (value: string) => void;
}) {
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  return (
    <PopoverButton
      align="end"
      side="bottom"
      className={`w-44 ${POPOVER_SURFACE_CLASS}`}
      trigger={(
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          aria-label={ariaLabel}
          className={`flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-ui text-foreground outline-none transition-colors hover:bg-hover focus:outline-none focus:ring-1 focus:ring-ring ${className}`}
        >
          <span className="min-w-0 truncate">{selectedOption?.label ?? "Select"}</span>
          <ChevronDown className="icon-paired shrink-0 text-muted-foreground" />
        </Button>
      )}
    >
      {(close) => (
        <div className="p-1">
          {options.map((option) => (
            <PopoverMenuItem
              key={option.value}
              density="compact"
              label={option.label}
              disabled={option.disabled || option.value === value}
              trailing={option.value === value ? <Check className="icon-paired" /> : null}
              onClick={() => {
                onChange(option.value);
                close();
              }}
            />
          ))}
        </div>
      )}
    </PopoverButton>
  );
}
