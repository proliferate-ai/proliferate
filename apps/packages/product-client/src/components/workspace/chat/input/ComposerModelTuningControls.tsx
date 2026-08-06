import { useState } from "react";
import { Check } from "#product/primitives/icons/core";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "#product/primitives/DropdownMenu";
import { PendingConfigIndicator } from "#product/components/workspace/chat/input/PendingConfigIndicator";
import { resolveReasoningEffortPresentation } from "#product/lib/domain/chat/session-controls/session-reasoning-effort-control";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";

interface ComposerModelTuningControlsProps {
  reasoningControl: LiveSessionControlDescriptor | null;
  fastModeControl: LiveSessionControlDescriptor | null;
  onEscapeKeyDown: () => void;
}

interface TuningOption {
  value: string;
  label: string;
  selected: boolean;
}

export function ComposerModelTuningControls({
  reasoningControl,
  fastModeControl,
  onEscapeKeyDown,
}: ComposerModelTuningControlsProps) {
  const reasoningOptions = reasoningControl?.options.map((option) => ({
    value: option.value,
    label: resolveReasoningEffortPresentation(option.value, option.label).shortLabel
      ?? option.label,
    selected: option.selected,
  })) ?? [];
  const selectedSpeedValue = fastModeControl?.options.find((option) => option.selected)?.value
    ?? (fastModeControl?.isEnabled
      ? fastModeControl.enabledValue
      : fastModeControl?.disabledValue);
  const speedOptions = fastModeControl?.options.map((option) => ({
    value: option.value,
    label: option.value === fastModeControl.enabledValue ? "Fast" : "Default",
    selected: option.value === selectedSpeedValue,
  })) ?? [];

  return (
    <>
      {reasoningControl && (
        <TuningSubmenu
          label="Effort"
          control={reasoningControl}
          options={reasoningOptions}
          onEscapeKeyDown={onEscapeKeyDown}
        />
      )}
      {fastModeControl && (
        <TuningSubmenu
          label="Speed"
          control={fastModeControl}
          options={speedOptions}
          onEscapeKeyDown={onEscapeKeyDown}
        />
      )}
    </>
  );
}

function TuningSubmenu({
  label,
  control,
  options,
  onEscapeKeyDown,
}: {
  label: "Effort" | "Speed";
  control: LiveSessionControlDescriptor;
  options: TuningOption[];
  onEscapeKeyDown: () => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.selected) ?? null;

  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger
        data-session-config-control={control.key}
        data-session-config-selected={selectedOption?.value ?? ""}
        className="py-2 text-composer"
        onClick={() => setOpen(true)}
      >
        <span className="min-w-0 flex-1">{label}</span>
        <span className="max-w-28 truncate text-muted-foreground">
          {selectedOption?.label ?? control.detail}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        sideOffset={4}
        alignOffset={-4}
        className="w-56"
        onEscapeKeyDown={onEscapeKeyDown}
      >
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            data-session-config-option={`${control.key}:${option.value}`}
            disabled={!control.settable}
            className="py-2 text-composer"
            onSelect={(event) => {
              event.preventDefault();
              control.onSelect(option.value);
            }}
          >
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            <span className="flex size-3.5 shrink-0 items-center justify-center">
              {option.selected && <Check className="icon-paired text-foreground/60" />}
              {option.selected && (
                <PendingConfigIndicator pendingState={control.pendingState} />
              )}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
