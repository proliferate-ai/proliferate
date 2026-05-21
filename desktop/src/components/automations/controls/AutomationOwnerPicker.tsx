import type { AutomationOwnerScope } from "@/lib/access/cloud/client";
import { PillControlButton } from "@/components/ui/PillControlButton";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { Check, Settings } from "@/components/ui/icons";

interface AutomationOwnerOption {
  value: AutomationOwnerScope;
  label: string;
  description: string;
  disabledReason?: string | null;
}

interface AutomationOwnerPickerProps {
  value: AutomationOwnerScope;
  organizationName?: string | null;
  options: AutomationOwnerOption[];
  onSelect: (value: AutomationOwnerScope) => void;
}

const POPOVER_CLASS = "w-72 rounded-xl border border-border bg-popover p-1 shadow-floating";

export function AutomationOwnerPicker({
  value,
  organizationName,
  options,
  onSelect,
}: AutomationOwnerPickerProps) {
  const selected = options.find((option) => option.value === value) ?? options[0];
  const label = selected?.label ?? "Personal";
  const detail = value === "organization" && organizationName ? organizationName : null;

  return (
    <PopoverButton
      trigger={(
        <PillControlButton
          aria-label="Automation owner"
          icon={<Settings className="size-3.5 shrink-0 text-muted-foreground" />}
          label={label}
          detail={detail}
          disclosure
          className="max-w-[14rem]"
        />
      )}
      side="top"
      className={POPOVER_CLASS}
    >
      {(close) => (
        <>
          {options.map((option) => (
            <PopoverMenuItem
              key={option.value}
              label={option.label}
              disabled={Boolean(option.disabledReason)}
              onClick={() => {
                if (option.disabledReason) {
                  return;
                }
                onSelect(option.value);
                close();
              }}
              trailing={option.value === value
                ? <Check className="size-3.5 text-foreground/70" />
                : null}
            >
              <span className="block truncate">
                {option.disabledReason ?? option.description}
              </span>
            </PopoverMenuItem>
          ))}
        </>
      )}
    </PopoverButton>
  );
}

