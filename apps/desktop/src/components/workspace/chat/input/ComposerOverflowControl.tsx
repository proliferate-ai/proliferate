import { useMemo } from "react";
import {
  resolveComposerControlOptionLabel,
} from "@/lib/domain/chat/session-controls/composer-config-submenu-presentation";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { Check, MoreHorizontal } from "@proliferate/ui/icons";
import { ComposerPopoverSurface } from "@proliferate/product-ui/chat/composer/ComposerPopoverSurface";
import { PendingConfigIndicator } from "./PendingConfigIndicator";

const EXCLUDED_OVERFLOW_KEYS = new Set(["mode", "collaboration_mode", "effort", "fast_mode"]);

interface ComposerOverflowControlProps {
  agentKind: string | null;
  controls: LiveSessionControlDescriptor[];
}

export function ComposerOverflowControl({
  agentKind,
  controls,
}: ComposerOverflowControlProps) {
  const overflowControls = useMemo(
    () => controls.filter((control) => !EXCLUDED_OVERFLOW_KEYS.has(control.key)),
    [controls],
  );

  if (overflowControls.length === 0) {
    return null;
  }

  return (
    <PopoverButton
      trigger={(
        <ComposerControlButton
          iconOnly
          icon={<MoreHorizontal className="size-4" />}
          label="More options"
          title="More configuration options"
          aria-label="More configuration options"
        />
      )}
      side="top"
      align="end"
      offset={8}
      className="w-auto border-0 bg-transparent p-0 shadow-none"
    >
      {() => (
        <ComposerPopoverSurface className="w-56 p-1">
          {overflowControls.map((control) => (
            <OverflowControlSection
              key={control.key}
              agentKind={agentKind}
              control={control}
            />
          ))}
        </ComposerPopoverSurface>
      )}
    </PopoverButton>
  );
}

function OverflowControlSection({
  agentKind,
  control,
}: {
  agentKind: string | null;
  control: LiveSessionControlDescriptor;
}) {
  return (
    <div>
      <div className="px-2.5 pb-0.5 pt-1.5 text-ui-sm font-medium text-muted-foreground">
        {control.label}
      </div>
      {control.options.map((option) => (
        <PopoverMenuItem
          key={option.value}
          label={resolveComposerControlOptionLabel(agentKind, control, option.value, option.label)}
          trailing={
            <span className="flex items-center gap-1">
              {option.selected && <Check className="size-3.5 shrink-0 text-foreground/60" />}
              {option.selected && control.pendingState && (
                <PendingConfigIndicator pendingState={control.pendingState} />
              )}
            </span>
          }
          disabled={!control.settable}
          onClick={() => {
            control.onSelect(option.value);
            // Intentionally NOT closing the popover — stays open for multi-adjust
          }}
        />
      ))}
    </div>
  );
}
