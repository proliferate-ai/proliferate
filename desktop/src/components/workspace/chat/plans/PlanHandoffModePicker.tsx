import { type ComponentType } from "react";
import type { ConfiguredSessionControlValue } from "@/config/session-control-presentations";
import { Button } from "@/components/ui/Button";
import { PopoverButton } from "@/components/ui/PopoverButton";
import {
  Check,
  ChevronDown,
  CircleQuestion,
  Pencil,
  PlanningIcon,
  Shield,
  Zap,
} from "@/components/ui/icons";
import { ComposerPopoverSurface } from "@/components/workspace/chat/input/ComposerPopoverSurface";
import type { SessionModeIconKey } from "@/lib/domain/chat/session-mode-control";

export interface PlanHandoffModePickerProps {
  options: ConfiguredSessionControlValue[];
  value: string | undefined;
  disabled?: boolean;
  onChange: (value: string) => void;
}

const MODE_ICONS: Record<SessionModeIconKey, ComponentType<{ className?: string }>> = {
  circleQuestion: CircleQuestion,
  pencil: Pencil,
  planning: PlanningIcon,
  shield: Shield,
  zap: Zap,
};

export function PlanHandoffModePicker({
  options,
  value,
  disabled = false,
  onChange,
}: PlanHandoffModePickerProps) {
  if (options.length === 0) {
    return null;
  }

  const selected = options.find((option) => option.value === value) ?? options[0] ?? null;
  const SelectedIcon = selected ? MODE_ICONS[selected.icon] : CircleQuestion;
  const selectedLabel = selected?.shortLabel ?? selected?.label ?? "Mode";

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <PopoverButton
        trigger={(
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            className="max-w-full justify-between rounded-lg px-2.5"
            aria-label={`Handoff mode: ${selectedLabel}`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <SelectedIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{selectedLabel}</span>
            </span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          </Button>
        )}
        align="start"
        side="top"
        offset={8}
        className="w-auto border-0 bg-transparent p-0 shadow-none"
      >
        {(close) => (
          <ComposerPopoverSurface className="w-64 p-1">
            {options.map((option) => {
              const Icon = MODE_ICONS[option.icon];
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
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
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
                  {selectedOption && <Check className="size-3.5 shrink-0 text-foreground/60" />}
                </Button>
              );
            })}
          </ComposerPopoverSurface>
        )}
      </PopoverButton>
      <span className="text-xs text-muted-foreground">
        Applies to this handoff only.
      </span>
    </div>
  );
}
