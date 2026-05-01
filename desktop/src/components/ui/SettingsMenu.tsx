import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { Check, ChevronUpDown } from "@/components/ui/icons";

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
  menuClassName = "w-56",
}: SettingsMenuProps) {
  return (
    <PopoverButton
      align="end"
      trigger={(
        <Button
          type="button"
          variant="outline"
          size="md"
          className={`justify-between bg-background px-3 text-foreground shadow-none hover:bg-accent/50 ${className}`}
        >
          {leading}
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronUpDown className="size-3 shrink-0 text-muted-foreground" />
        </Button>
      )}
      className={`${menuClassName} rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-floating`}
    >
      {(close) => (
        <div className="max-h-80 overflow-y-auto">
          {groups.map((group, groupIndex) => (
            <div key={group.id}>
              {groupIndex > 0 && <div className="my-1 border-t border-border/40" />}
              {group.label && (
                <div className="px-2 pb-1 pt-1.5 text-sm text-muted-foreground">
                  {group.label}
                </div>
              )}
              {group.options.map((option) => (
                <PopoverMenuItem
                  key={option.id}
                  label={option.label}
                  icon={option.icon}
                  disabled={option.disabled}
                  className={option.selected ? "text-foreground" : "text-muted-foreground"}
                  trailing={option.selected ? <Check className="size-3.5" /> : undefined}
                  onClick={() => {
                    option.onSelect();
                    close();
                  }}
                >
                  {option.detail && (
                    <span className="block truncate text-xs text-muted-foreground">
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
