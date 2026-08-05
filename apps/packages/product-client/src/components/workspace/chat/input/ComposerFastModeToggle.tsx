import {
  resolveSessionControlTooltip,
  resolveSessionToggleControlStateLabel,
} from "#product/lib/domain/chat/session-controls/session-toggle-control";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import { Zap } from "#product/primitives/icons/product";
import { Tooltip } from "#product/primitives/Tooltip";
import { ComposerControlButton } from "#product/primitives/patterns/ComposerControlButton";
import { PendingConfigIndicator } from "#product/components/workspace/chat/input/PendingConfigIndicator";

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

  const toggle = (
    <ComposerControlButton
      iconOnly
      disabled={!control.settable || !nextValue}
      active={!!control.isEnabled}
      className={control.isEnabled ? "bg-hover" : ""}
      icon={
        <Zap
          className={`icon-control transition-[color,fill,opacity] ${
            control.isEnabled
              ? "fill-current stroke-none opacity-100"
              : "fill-none stroke-current stroke-[1.5] text-composer-control-muted-foreground opacity-100"
          }`}
        />
      }
      label="Fast"
      aria-label={tooltip}
      title={tooltip}
      onClick={() => {
        if (nextValue) {
          control.onSelect(nextValue);
        }
      }}
    />
  );

  if (control.pendingState) {
    return (
      <Tooltip content={tooltip}>
        <span className="inline-flex items-center gap-1">
          {toggle}
          <PendingConfigIndicator pendingState={control.pendingState} />
        </span>
      </Tooltip>
    );
  }

  return <Tooltip content={tooltip}>{toggle}</Tooltip>;
}
