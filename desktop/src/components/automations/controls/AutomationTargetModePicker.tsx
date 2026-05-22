import type { AutomationTargetMode } from "@proliferate/cloud-sdk";
import { PillControlButton } from "@/components/ui/PillControlButton";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import {
  Check,
  CloudIcon,
  FolderOpen,
} from "@/components/ui/icons";

interface AutomationTargetModeOption {
  value: AutomationTargetMode;
  label: string;
  description: string;
  disabledReason?: string | null;
}

interface AutomationTargetModePickerProps {
  value: AutomationTargetMode;
  options: AutomationTargetModeOption[];
  onSelect: (value: AutomationTargetMode) => void;
}

const POPOVER_CLASS = "w-80 rounded-xl border border-border bg-popover p-1 shadow-floating";

export function AutomationTargetModePicker({
  value,
  options,
  onSelect,
}: AutomationTargetModePickerProps) {
  const selected = options.find((option) => option.value === value) ?? options[0];
  const triggerLabel = selected?.label ?? "Target mode";

  return (
    <PopoverButton
      trigger={(
        <PillControlButton
          aria-label="Target mode"
          icon={targetModeIcon(value)}
          label={triggerLabel}
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
              icon={targetModeIcon(option.value)}
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

function targetModeIcon(value: AutomationTargetMode) {
  return value === "local"
    ? <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
    : <CloudIcon className="size-3.5 shrink-0 text-muted-foreground" />;
}

