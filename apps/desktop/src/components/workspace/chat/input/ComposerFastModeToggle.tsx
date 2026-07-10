import {
  resolveSessionControlTooltip,
  resolveSessionToggleControlStateLabel,
} from "@/lib/domain/chat/session-controls/session-toggle-control";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import { Zap } from "@proliferate/ui/icons";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { PendingConfigIndicator } from "./PendingConfigIndicator";

interface ComposerFastModeToggleProps {
  control: LiveSessionControlDescriptor;
}

export function ComposerFastModeToggle({ control }: ComposerFastModeToggleProps) {
  const nextValue = control.isEnabled ? control.disabledValue : control.enabledValue;
  const selectedOption = control.options.find((option) => option.selected) ?? null;
  const stateLabel = resolveSessionToggleControlStateLabel("fast_mode", !!control.isEnabled);
  const tooltip = resolveSessionControlTooltip(
    control.label,
    stateLabel,
    selectedOption?.description,
  );

  return (
    <Tooltip content={tooltip}>
      <ComposerControlButton
        iconOnly
        disabled={!control.settable || !nextValue}
        active={!!control.isEnabled}
        icon={
          <Zap
            className={`size-3.5 ${control.isEnabled ? "fill-current" : "opacity-65"}`}
          />
        }
        label="Fast"
        trailing={<PendingConfigIndicator pendingState={control.pendingState} />}
        aria-label={tooltip}
        title={tooltip}
        onClick={() => {
          if (nextValue) {
            control.onSelect(nextValue);
          }
        }}
      />
    </Tooltip>
  );
}
