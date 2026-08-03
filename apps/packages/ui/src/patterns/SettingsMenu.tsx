import type { ReactNode } from "react";
import { Check, ChevronDown } from "../icons/core";
import { Button } from "../primitives/Button";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "../primitives/PopoverButton";
import { PopoverMenuItem } from "../primitives/PopoverMenuItem";

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

/**
 * Settings-row select. The trigger sits on the app's 28px control tier, the
 * same height as composer controls, so adjacent settings rows read as one
 * list instead of three different heights.
 *
 * The height is a plain `h-7` because the semantic control-height tier utility
 * is still landing in the design layer (alongside the em-based `icon-*` tiers);
 * this converts to that utility in one line once it exists. Callers that live
 * in a form-field context rather than a settings row can override the height
 * through `className` — it is merged after the base classes.
 */
export function SettingsMenu({
  label,
  leading,
  groups,
  className = "w-[240px]",
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
          // `[&_svg]:icon-paired` sizes a bare icon passed through `leading`
          // (the same descendant-selector idiom `SegmentedControl` and
          // `RadioCardGroup` use). Without it an unsized SVG renders at its
          // viewport default and every call site has to compensate.
          className={`h-7 justify-between rounded-lg border border-input bg-transparent px-2.5 text-ui font-control leading-4 text-foreground shadow-none [&_svg]:icon-paired hover:bg-hover active:bg-active data-[state=open]:bg-active ${className}`}
        >
          {leading}
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDown className="icon-paired shrink-0 text-muted-foreground" />
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
                <div className="min-h-6 truncate px-2 py-1 text-ui-sm text-foreground-tertiary">
                  {group.label}
                </div>
              )}
              {group.options.map((option) => (
                <PopoverMenuItem
                  key={option.id}
                  label={option.label}
                  icon={option.icon}
                  disabled={option.disabled}
                  trailing={option.selected ? <Check className="icon-paired" /> : undefined}
                  onClick={() => {
                    option.onSelect();
                    close();
                  }}
                >
                  {option.detail && (
                    <span className="block truncate text-ui-sm text-foreground-tertiary">
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
