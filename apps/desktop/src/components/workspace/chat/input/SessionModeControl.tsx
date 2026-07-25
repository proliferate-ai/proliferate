import { CHAT_MODE_CONTROL_LABELS } from "@/copy/chat/chat-copy";
import {
  resolveSessionControlPresentation,
} from "@/lib/domain/chat/session-controls/session-mode-control";
import {
  isSessionControlUpdatePending,
  resolveSessionControlTooltip,
} from "@/lib/domain/chat/session-controls/session-control-tooltip";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import type { ConfiguredSessionControlKey } from "@/lib/domain/chat/session-controls/presentation";
import { SessionControlIcon } from "@/components/session-controls/SessionControlIcon";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { Check, ChevronDown } from "@proliferate/ui/icons";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import { PendingConfigIndicator } from "./PendingConfigIndicator";

type ModeControlDescriptor = LiveSessionControlDescriptor & {
  key: ConfiguredSessionControlKey;
};

interface SessionModeControlProps {
  agentKind: string | null;
  control: ModeControlDescriptor;
  triggerStyle?: "full" | "value";
}

export function SessionModeControl({
  agentKind,
  control,
  triggerStyle = "full",
}: SessionModeControlProps) {
  const currentOption = control.options.find((option) => option.selected) ?? null;
  const currentValue = currentOption?.value ?? null;
  const currentPresentation = resolveSessionControlPresentation(
    agentKind,
    control.key,
    currentValue,
  );
  const currentDetail = currentPresentation.shortLabel ?? currentOption?.label ?? control.detail;
  const triggerLabel = triggerStyle === "value" ? currentDetail ?? control.label : control.label;
  const triggerDetail = triggerStyle === "value" ? null : currentDetail;
  const compactTrigger = triggerStyle === "value";
  const triggerIcon = compactTrigger
    ? undefined
    : <SessionControlIcon icon={currentPresentation.icon} className="size-3.5" />;
  const showPendingIndicator = !compactTrigger && control.pendingState;
  const triggerTrailing = showPendingIndicator || (compactTrigger && control.settable)
    ? (
      <span className="flex items-center gap-1">
        {showPendingIndicator && (
          <PendingConfigIndicator pendingState={control.pendingState} />
        )}
        {compactTrigger && control.settable && (
          <ChevronDown
            className="size-3 shrink-0 text-[color:var(--color-composer-control-muted-foreground)]"
            aria-hidden
          />
        )}
      </span>
    )
    : null;
  const tooltip = resolveSessionControlTooltip({
    label: control.label,
    value: currentOption?.label ?? currentDetail,
    description: currentOption?.description ?? null,
    hint: compactTrigger && control.settable
      ? `${CHAT_MODE_CONTROL_LABELS.shortcut} cycles modes.`
      : null,
    pendingState: compactTrigger ? control.pendingState : null,
  });

  if (!control.settable) {
    const trigger = (
      <ComposerControlButton
        disabled
        emphasizeLabel={triggerStyle === "value"}
        icon={triggerIcon}
        label={triggerLabel}
        detail={triggerDetail}
        trailing={triggerTrailing}
        className="max-w-[12rem]"
      />
    );
    return compactTrigger
      ? <Tooltip content={tooltip}>{trigger}</Tooltip>
      : trigger;
  }

  const popover = (
    <PopoverButton
      trigger={
        <ComposerControlButton
          emphasizeLabel={triggerStyle === "value"}
          icon={triggerIcon}
          label={triggerLabel}
          detail={triggerDetail}
          trailing={triggerTrailing}
          aria-label={`${control.label}: ${currentOption?.label ?? currentDetail ?? ""}`}
          aria-busy={compactTrigger && isSessionControlUpdatePending(control.pendingState)}
          className="max-w-[12rem]"
        />
      }
      side="top"
      className={`w-56 ${POPOVER_SURFACE_CLASS}`}
    >
      {(close) => (
        <>
          {control.options.map((option) => {
            const presentation = resolveSessionControlPresentation(
              agentKind,
              control.key,
              option.value,
            );
            return (
              <PopoverMenuItem
                key={option.value}
                icon={<SessionControlIcon icon={presentation.icon} className="size-3.5 text-muted-foreground" />}
                label={presentation.shortLabel ?? option.label}
                trailing={option.selected ? <Check className="size-3.5 shrink-0 text-foreground/60" /> : null}
                onClick={() => {
                  control.onSelect(option.value);
                  close();
                }}
              />
            );
          })}
        </>
      )}
    </PopoverButton>
  );

  return compactTrigger
    ? <Tooltip content={tooltip}>{popover}</Tooltip>
    : popover;
}
