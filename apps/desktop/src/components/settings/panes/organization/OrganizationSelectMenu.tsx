import { Check, ChevronDown } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";

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
          className={`flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors hover:bg-list-hover focus:outline-none focus:ring-1 focus:ring-ring ${className}`}
        >
          <span className="min-w-0 truncate">{selectedOption?.label ?? "Select"}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
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
              trailing={option.value === value ? <Check className="size-3.5" /> : null}
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
