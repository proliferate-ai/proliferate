import {
  resolveSessionToggleControlStateLabel,
} from "@/lib/domain/chat/session-controls/session-toggle-control";
import {
  isSessionControlUpdatePending,
  resolveSessionControlTooltip,
} from "@/lib/domain/chat/session-controls/session-control-tooltip";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import { Zap } from "@proliferate/ui/icons";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";

interface ComposerFastModeToggleProps {
  control: LiveSessionControlDescriptor;
}

export function ComposerFastModeToggle({ control }: ComposerFastModeToggleProps) {
  const nextValue = control.isEnabled ? control.disabledValue : control.enabledValue;
  const selectedOption = control.options.find((option) => option.selected) ?? null;
  const stateLabel = resolveSessionToggleControlStateLabel("fast_mode", !!control.isEnabled);
  const tooltip = resolveSessionControlTooltip({
    label: control.label,
    value: stateLabel,
    description: selectedOption?.description,
    hint: control.settable ? "Click to toggle." : null,
    pendingState: control.pendingState,
  });

  return (
    <Tooltip content={tooltip}>
      <ComposerControlButton
        iconOnly
        disabled={!control.settable || !nextValue}
        active={!!control.isEnabled}
        className={control.isEnabled ? "bg-[var(--color-composer-control-hover)]" : ""}
        icon={
          <Zap
            className={`size-3.5 transition-[color,fill,opacity] ${
              control.isEnabled
                ? "fill-current stroke-none opacity-100"
                : "fill-none stroke-current stroke-[1.5] text-[color:var(--color-composer-control-muted-foreground)] opacity-100"
            }`}
          />
        }
        label="Fast"
        aria-label={`${control.label}: ${stateLabel}`}
        aria-busy={isSessionControlUpdatePending(control.pendingState)}
        onClick={() => {
          if (nextValue) {
            control.onSelect(nextValue);
          }
        }}
      />
    </Tooltip>
  );
}
