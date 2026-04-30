import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { PickerPopoverContent } from "@/components/ui/PickerPopoverContent";
import { PillControlButton } from "@/components/ui/PillControlButton";
import { PopoverButton } from "@/components/ui/PopoverButton";
import {
  Check,
  CircleAlert,
  Pencil,
  Shield,
  Sparkles,
  Zap,
} from "@/components/ui/icons";
import type {
  ConfiguredSessionControlValue,
  SessionControlIconKey,
} from "@/config/session-control-presentations";

interface HomeModePickerProps {
  modes: ConfiguredSessionControlValue[];
  selectedMode: ConfiguredSessionControlValue | null;
  onSelect: (modeId: string) => void;
}

function iconForMode(icon: SessionControlIconKey, className = "size-3.5") {
  switch (icon) {
    case "pencil":
      return <Pencil className={className} />;
    case "shield":
      return <Shield className={className} />;
    case "zap":
      return <Zap className={className} />;
    case "planning":
      return <Sparkles className={className} />;
    case "circleQuestion":
      return <CircleAlert className={className} />;
  }
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
          icon={iconForMode(selectedMode.icon)}
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
              icon={iconForMode(mode.icon)}
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
