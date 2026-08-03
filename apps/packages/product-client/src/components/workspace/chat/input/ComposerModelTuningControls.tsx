import { Check, Zap } from "@proliferate/ui/icons";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { PendingConfigIndicator } from "#product/components/workspace/chat/input/PendingConfigIndicator";
import { resolveReasoningEffortPresentation } from "#product/lib/domain/chat/session-controls/session-reasoning-effort-control";
import { resolveSessionToggleControlStateLabel } from "#product/lib/domain/chat/session-controls/session-toggle-control";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";

interface ComposerModelTuningControlsProps {
  reasoningControl: LiveSessionControlDescriptor | null;
  fastModeControl: LiveSessionControlDescriptor | null;
}

export function ComposerModelTuningControls({
  reasoningControl,
  fastModeControl,
}: ComposerModelTuningControlsProps) {
  const selectedReasoningValue = reasoningControl?.options
    .find((option) => option.selected)?.value ?? "";
  const selectedFastModeValue = fastModeControl?.options.find((option) => option.selected)?.value
    ?? (fastModeControl?.isEnabled
      ? fastModeControl.enabledValue
      : fastModeControl?.disabledValue)
    ?? "";
  const nextFastModeValue = fastModeControl?.isEnabled
    ? fastModeControl.disabledValue
    : fastModeControl?.enabledValue;

  return (
    <div className="mt-1 border-t border-border pt-1">
      {reasoningControl && (
        <div
          data-session-config-control={reasoningControl.key}
          data-session-config-selected={selectedReasoningValue}
        >
          <div className="px-2.5 pb-1 pt-1.5 text-ui-sm text-muted-foreground">
            Reasoning effort
          </div>
          {reasoningControl.options.map((option) => (
            <PopoverMenuItem
              key={option.value}
              data-session-config-option={`${reasoningControl.key}:${option.value}`}
              label={resolveReasoningEffortPresentation(
                option.value,
                option.label,
              ).shortLabel ?? option.label}
              trailing={(
                <span className="flex items-center gap-1">
                  {option.selected && <Check className="icon-paired text-foreground/60" />}
                  {option.selected && (
                    <PendingConfigIndicator pendingState={reasoningControl.pendingState} />
                  )}
                </span>
              )}
              disabled={!reasoningControl.settable}
              labelClassName="text-composer"
              className={`px-2.5 py-2 ${option.selected ? "bg-hover" : ""}`}
              onClick={() => reasoningControl.onSelect(option.value)}
            />
          ))}
        </div>
      )}

      {fastModeControl && (
        <PopoverMenuItem
          data-session-config-control={fastModeControl.key}
          data-session-config-selected={selectedFastModeValue}
          data-session-config-option={`${fastModeControl.key}:${nextFastModeValue ?? ""}`}
          icon={<Zap className={`icon-paired ${fastModeControl.isEnabled ? "fill-current" : ""}`} />}
          label="Fast mode"
          trailing={(
            <span className="flex items-center gap-1 text-muted-foreground">
              <span>{resolveSessionToggleControlStateLabel("fast_mode", !!fastModeControl.isEnabled)}</span>
              <PendingConfigIndicator pendingState={fastModeControl.pendingState} />
            </span>
          )}
          disabled={!fastModeControl.settable || !nextFastModeValue}
          labelClassName="text-composer"
          className="px-2.5 py-2"
          onClick={() => {
            if (nextFastModeValue) {
              fastModeControl.onSelect(nextFastModeValue);
            }
          }}
        />
      )}
    </div>
  );
}
