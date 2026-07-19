import {
  resolveSessionControlTooltip,
  resolveSessionToggleControlStateLabel,
} from "#product/lib/domain/chat/session-controls/session-toggle-control";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import { Zap } from "@proliferate/ui/icons";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
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

  // The pending indicator renders as a sibling, never inside the fixed-width
  // icon-only button: a trailing node in that box fights `justify-center` and
  // visibly shoves the zap glyph sideways while a change is queued (the
  // reasoning bars already follow this sibling pattern).
  const toggle = (
    <ComposerControlButton
      iconOnly
      disabled={!control.settable || !nextValue}
      active={!!control.isEnabled}
      className={control.isEnabled ? "bg-[var(--color-composer-control-hover)]" : ""}
      icon={
        <Zap
          className={`icon-paired transition-[color,fill,opacity] ${
            control.isEnabled
              ? "fill-current stroke-none opacity-100"
              : "fill-none stroke-current stroke-[1.5] text-[color:var(--color-composer-control-muted-foreground)] opacity-100"
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
