import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { PickerPopoverContent } from "@/components/ui/PickerPopoverContent";
import { PillControlButton } from "@/components/ui/PillControlButton";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { Check } from "@/components/ui/icons";
import { SessionControlIcon } from "@/components/session-controls/SessionControlIcon";
import type { ConfiguredSessionControlValue } from "@/config/session-control-presentations";

interface HomeModePickerProps {
  modes: ConfiguredSessionControlValue[];
  selectedMode: ConfiguredSessionControlValue | null;
  onSelect: (modeId: string) => void;
}

export function HomeModePicker({
  modes,
  selectedMode,
  onSelect,
}: HomeModePickerProps) {
  if (modes.length === 0 || !selectedMode) {
    return null;
  }

  return (
    <PopoverButton
      trigger={(
        <PillControlButton
          icon={<SessionControlIcon icon={selectedMode.icon} className="size-3.5" />}
          label={selectedMode.shortLabel ?? selectedMode.label}
          disclosure
          className="max-w-[12rem]"
        />
      )}
      side="top"
      className="w-72 rounded-xl border border-border bg-popover p-1 shadow-floating"
    >
      {(close) => (
        <PickerPopoverContent>
          {modes.map((mode) => (
            <PopoverMenuItem
              key={mode.value}
              icon={<SessionControlIcon icon={mode.icon} className="size-3.5" />}
              label={mode.label}
              trailing={selectedMode.value === mode.value ? <Check className="size-3.5" /> : null}
              onClick={() => {
                onSelect(mode.value);
                close();
              }}
            >
              {mode.description ? (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {mode.description}
                </span>
              ) : null}
            </PopoverMenuItem>
          ))}
        </PickerPopoverContent>
      )}
    </PopoverButton>
  );
}
