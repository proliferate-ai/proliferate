import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { Check, ChevronDown } from "@/components/ui/icons";

export interface SettingsMenuOption {
  id: string;
  label: string;
  detail?: string | null;
  icon?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface SettingsMenuGroup {
  id: string;
  label?: string;
  options: SettingsMenuOption[];
}

interface SettingsMenuProps {
  label: string;
  leading?: ReactNode;
  groups: SettingsMenuGroup[];
  className?: string;
  menuClassName?: string;
}

export function SettingsMenu({
  label,
  leading,
  groups,
  className = "w-44",
  menuClassName = "w-60",
}: SettingsMenuProps) {
  return (
    <PopoverButton
      align="end"
      side="auto"
      trigger={(
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={`h-8 justify-between rounded-md border-transparent bg-surface-control px-2.5 text-sm font-[430] leading-4 text-foreground shadow-none hover:bg-list-hover data-[state=open]:bg-list-hover ${className}`}
        >
          {leading}
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      )}
      className={`${menuClassName} ${POPOVER_SURFACE_CLASS}`}
    >
      {(close) => (
        <div className="max-h-80 overflow-y-auto">
          {groups.map((group, groupIndex) => (
            <div key={group.id}>
              {groupIndex > 0 && <div className="my-1 border-t border-border-light" />}
              {group.label && (
                <div className="min-h-6 truncate px-2 py-1 text-sm leading-4 text-foreground-tertiary">
                  {group.label}
                </div>
              )}
              {group.options.map((option) => (
                <PopoverMenuItem
                  key={option.id}
                  label={option.label}
                  icon={option.icon}
                  disabled={option.disabled}
                  trailing={option.selected ? <Check className="size-3.5" /> : undefined}
                  onClick={() => {
                    option.onSelect();
                    close();
                  }}
                >
                  {option.detail && (
                    <span className="block truncate text-sm leading-4 text-foreground-tertiary">
                      {option.detail}
                    </span>
                  )}
                </PopoverMenuItem>
              ))}
            </div>
          ))}
        </div>
      )}
    </PopoverButton>
  );
}
