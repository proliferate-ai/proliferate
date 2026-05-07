import { resolveReasoningEffortPresentation } from "@/lib/domain/chat/session-controls/session-reasoning-effort-control";
import { resolveSessionControlTooltip } from "@/lib/domain/chat/session-controls/session-toggle-control";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import { Brain, Check, ChevronDown } from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/Tooltip";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { ComposerControlButton } from "./ComposerControlButton";
import { PendingConfigIndicator } from "./PendingConfigIndicator";

interface SessionReasoningEffortControlProps {
  control: LiveSessionControlDescriptor;
}

const POPOVER_ROW =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground hover:bg-accent";

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
      className="w-56 rounded-xl border border-border bg-popover p-1 shadow-floating"
    >
      {(close) => (
        <>
          {control.options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                control.onSelect(option.value);
                close();
              }}
              className={POPOVER_ROW}
            >
              <Brain className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-left">{option.label}</span>
              {option.selected && <Check className="size-3.5 shrink-0 text-foreground/60" />}
            </button>
          ))}
        </>
      )}
    </PopoverButton>
  );
}
