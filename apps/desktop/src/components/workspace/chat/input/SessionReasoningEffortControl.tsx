import { resolveReasoningEffortPresentation } from "@/lib/domain/chat/session-controls/session-reasoning-effort-control";
import { resolveSessionControlTooltip } from "@/lib/domain/chat/session-controls/session-toggle-control";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import { Brain, Check, ChevronDown } from "@proliferate/ui/icons";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { ComposerControlButton } from "@proliferate/product-ui/chat/composer/ComposerControlButton";
import { PendingConfigIndicator } from "./PendingConfigIndicator";

interface SessionReasoningEffortControlProps {
  control: LiveSessionControlDescriptor;
}

export function SessionReasoningEffortControl({ control }: SessionReasoningEffortControlProps) {
  const currentOption = control.options.find((option) => option.selected) ?? null;
  const currentPresentation = resolveReasoningEffortPresentation(
    currentOption?.value ?? null,
    currentOption?.label,
  );
  const tooltip = resolveSessionControlTooltip(
    control.label,
    currentPresentation.shortLabel ?? control.detail ?? control.label,
    currentOption?.description ?? null,
  );
  const currentLabel = currentPresentation.shortLabel ?? control.detail ?? control.label;

  if (!control.settable) {
    return (
      <Tooltip content={tooltip}>
        <ComposerControlButton
          disabled
          tone={currentPresentation.tone}
          icon={<Brain className="size-3.5" />}
          label={currentLabel}
          trailing={<PendingConfigIndicator pendingState={control.pendingState} />}
          aria-label={tooltip}
          className="max-w-[12rem]"
        />
      </Tooltip>
    );
  }

  return (
    <PopoverButton
      trigger={
        <span className="inline-flex shrink-0">
          <Tooltip content={tooltip}>
            <ComposerControlButton
              tone={currentPresentation.tone}
              icon={<Brain className="size-3.5" />}
              label={currentLabel}
              trailing={
                <span className="flex items-center gap-1">
                  <PendingConfigIndicator pendingState={control.pendingState} />
                  <ChevronDown className="size-3.5 shrink-0 text-[color:var(--color-composer-control-muted-foreground)]" />
                </span>
              }
              aria-label={tooltip}
              className="max-w-[12rem]"
            />
          </Tooltip>
        </span>
      }
      side="top"
      className={`w-56 ${POPOVER_SURFACE_CLASS}`}
    >
      {(close) => (
        <>
          {control.options.map((option) => (
            <PopoverMenuItem
              key={option.value}
              icon={<Brain className="size-3.5 shrink-0" />}
              label={option.label}
              trailing={option.selected ? <Check className="size-3.5 shrink-0 text-foreground/60" /> : null}
              onClick={() => {
                control.onSelect(option.value);
                close();
              }}
            />
          ))}
        </>
      )}
    </PopoverButton>
  );
}
