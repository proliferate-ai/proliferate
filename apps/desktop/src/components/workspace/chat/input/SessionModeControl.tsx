import { CHAT_MODE_CONTROL_LABELS } from "@/copy/chat/chat-copy";
import {
  resolveSessionControlPresentation,
} from "@/lib/domain/chat/session-controls/session-mode-control";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import type { ConfiguredSessionControlKey } from "@/lib/domain/chat/session-controls/presentation";
import { SessionControlIcon } from "@/components/session-controls/SessionControlIcon";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { Check } from "@proliferate/ui/icons";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
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

  if (!control.settable) {
    return (
      <ComposerControlButton
        disabled
        emphasizeLabel={triggerStyle === "value"}
        icon={<SessionControlIcon icon={currentPresentation.icon} className="size-3.5" />}
        label={triggerLabel}
        detail={triggerDetail}
        trailing={<PendingConfigIndicator pendingState={control.pendingState} />}
        className="max-w-[12rem]"
      />
    );
  }

  return (
    <PopoverButton
      trigger={
        <ComposerControlButton
          emphasizeLabel={triggerStyle === "value"}
          icon={<SessionControlIcon icon={currentPresentation.icon} className="size-3.5" />}
          label={triggerLabel}
          detail={triggerDetail}
          trailing={<PendingConfigIndicator pendingState={control.pendingState} />}
          title={`${CHAT_MODE_CONTROL_LABELS.cycleHint} (${CHAT_MODE_CONTROL_LABELS.shortcut})`}
          aria-label={`${control.label}: ${currentOption?.label ?? currentDetail ?? ""}`}
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
}
