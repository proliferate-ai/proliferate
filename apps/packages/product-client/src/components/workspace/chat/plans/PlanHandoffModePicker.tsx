import type { ConfiguredSessionControlValue } from "#product/lib/domain/chat/session-controls/presentation";
import { Button } from "@proliferate/ui/primitives/Button";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { Check, ChevronDown } from "@proliferate/ui/icons";
import { SessionControlIcon } from "#product/components/session-controls/SessionControlIcon";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { ComposerPopoverSurface } from "@proliferate/product-ui/chat/composer/ComposerPopoverSurface";

export interface PlanHandoffModePickerProps {
  options: ConfiguredSessionControlValue[];
  value: string | undefined;
  disabled?: boolean;
  showHelperText?: boolean;
  onChange: (value: string) => void;
}

export function PlanHandoffModePicker({
  options,
  value,
  disabled = false,
  showHelperText = true,
  onChange,
}: PlanHandoffModePickerProps) {
  if (options.length === 0) {
    return null;
  }

  const selected = options.find((option) => option.value === value) ?? options[0] ?? null;
  const selectedLabel = selected?.shortLabel ?? selected?.label ?? "Mode";

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <PopoverButton
        trigger={(
          <ComposerControlButton
            type="button"
            disabled={disabled}
            icon={<SessionControlIcon icon={selected?.icon} className="icon-paired shrink-0 text-muted-foreground [font-size:var(--text-chat)]" />}
            label={selectedLabel}
            trailing={<ChevronDown className="icon-compact shrink-0 text-muted-foreground" />}
            className="max-w-full"
            aria-label={`Handoff mode: ${selectedLabel}`}
          />
        )}
        align="start"
        side="top"
        offset={8}
        className="w-auto border-0 bg-transparent p-0 shadow-none"
      >
        {(close) => (
          <ComposerPopoverSurface className="w-64 p-1">
            {options.map((option) => {
              const selectedOption = option.value === selected?.value;
              return (
                <Button
                  key={option.value}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onChange(option.value);
                    close();
                  }}
                  className="h-auto w-full justify-start rounded-lg px-2.5 py-2 text-left"
                >
                  <SessionControlIcon icon={option.icon} className="icon-paired shrink-0 text-muted-foreground [font-size:var(--text-chat)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">
                      {option.shortLabel ?? option.label}
                    </span>
                    {option.description && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    )}
                  </span>
                  {selectedOption && <Check className="icon-paired shrink-0 text-foreground/60" />}
                </Button>
              );
            })}
          </ComposerPopoverSurface>
        )}
      </PopoverButton>
      {showHelperText && (
        <span className="text-xs text-muted-foreground">
          Applies to this handoff only.
        </span>
      )}
    </div>
  );
}
