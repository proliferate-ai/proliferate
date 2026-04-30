import type { ConfiguredSessionControlValue } from "@/config/session-control-presentations";
import type { AutomationModeResolution } from "@/lib/domain/automations/mode-selection";
import type { SessionModeIconKey } from "@/lib/domain/chat/session-mode-control";
import { PickerEmptyRow, PickerPopoverContent } from "@/components/ui/PickerPopoverContent";
import { PillControlButton } from "@/components/ui/PillControlButton";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { Check } from "@/components/ui/icons";
import { SessionControlIcon } from "@/components/session-controls/SessionControlIcon";

interface AutomationModePickerProps {
  options: ConfiguredSessionControlValue[];
  resolution: AutomationModeResolution;
  disabled: boolean;
  onSelect: (modeId: string) => void;
  onDefaultSelect: () => void;
}

const POPOVER_CLASS = "w-64 rounded-xl border border-border bg-popover p-1 shadow-floating";

export function AutomationModePicker({
  options,
  resolution,
  disabled,
  onSelect,
  onDefaultSelect,
}: AutomationModePickerProps) {
  const trigger = resolveTrigger(resolution);
  const selectedValue = resolution.state === "selected"
    ? resolution.value.value
    : resolution.state === "default"
      && resolution.source !== "savedNull"
      && resolution.source !== "overrideNull"
      ? resolution.value?.value ?? null
      : null;

  return (
    <PopoverButton
      trigger={(
        <PillControlButton
          aria-label="Mode"
          disabled={disabled || options.length === 0}
          icon={(
            <SessionControlIcon
              icon={trigger.icon}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          )}
          label={trigger.label}
          disclosure
          className="max-w-[12rem]"
        />
      )}
      side="top"
      className={POPOVER_CLASS}
    >
      {(close) => (
        <PickerPopoverContent className="max-h-72">
          {options.length === 0 ? (
            <PickerEmptyRow label="No modes" />
          ) : (
            <>
              <PopoverMenuItem
                label="Default mode"
                icon={(
                  <SessionControlIcon
                    icon="unknown"
                    className="size-3.5 text-muted-foreground"
                  />
                )}
                onClick={() => {
                  onDefaultSelect();
                  close();
                }}
                trailing={resolution.state === "default"
                  && (resolution.source === "savedNull" || resolution.source === "overrideNull")
                  ? <Check className="size-3.5 text-foreground/70" />
                  : null}
              >
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  Use the runtime default mode
                </span>
              </PopoverMenuItem>
              {options.map((option) => {
                return (
                  <PopoverMenuItem
                    key={option.value}
                    label={option.shortLabel ?? option.label}
                    icon={(
                      <SessionControlIcon
                        icon={option.icon}
                        className="size-3.5 text-muted-foreground"
                      />
                    )}
                    onClick={() => {
                      onSelect(option.value);
                      close();
                    }}
                    trailing={selectedValue === option.value
                      ? <Check className="size-3.5 text-foreground/70" />
                      : null}
                  >
                    {option.description && (
                      <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    )}
                  </PopoverMenuItem>
                );
              })}
            </>
          )}
        </PickerPopoverContent>
      )}
    </PopoverButton>
  );
}

function resolveTrigger(
  resolution: AutomationModeResolution,
): { label: string; icon: SessionModeIconKey } {
  if (resolution.state === "selected") {
    return {
      label: resolution.value.shortLabel ?? resolution.value.label,
      icon: resolution.value.icon,
    };
  }
  if (resolution.state === "default") {
    return {
      label: resolution.source === "savedNull" || resolution.source === "overrideNull"
        ? "Default mode"
        : resolution.value?.shortLabel ?? resolution.value?.label ?? "Default mode",
      icon: resolution.value?.icon ?? "unknown",
    };
  }
  if (resolution.state === "savedUnavailable") {
    return { label: "Saved mode unavailable", icon: "unknown" };
  }
  return { label: "Mode", icon: "unknown" };
}
