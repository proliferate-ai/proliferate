import { CHAT_MODE_CONTROL_LABELS } from "#product/copy/chat/chat-copy";
import {
  getNextSessionModeValue,
  resolveSessionControlPresentation,
} from "#product/lib/domain/chat/session-controls/session-mode-control";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import type { ConfiguredSessionControlKey } from "#product/lib/domain/chat/session-controls/presentation";
import { SessionControlIcon } from "#product/components/session-controls/SessionControlIcon";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { Check } from "@proliferate/ui/icons";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { AnimatedSwapText } from "@proliferate/ui/primitives/AnimatedSwapText";
import { PendingConfigIndicator } from "#product/components/workspace/chat/input/PendingConfigIndicator";

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
  const animatedValue = (
    <AnimatedSwapText
      valueKey={currentValue ?? String(currentDetail ?? control.label)}
      value={triggerStyle === "value" ? triggerLabel : triggerDetail}
    />
  );
  const visibleTriggerLabel = triggerStyle === "value" ? animatedValue : triggerLabel;
  const visibleTriggerDetail = triggerStyle === "value" ? null : animatedValue;
  const compactTrigger = triggerStyle === "value";
  const nextValue = getNextSessionModeValue(control.options, currentValue);
  const triggerIcon = compactTrigger
    ? undefined
    : <SessionControlIcon icon={currentPresentation.icon} className="icon-paired [font-size:var(--text-composer)]" />;
  // No disclosure chevron on the compact trigger: the mode name itself steps
  // immediately to the next runtime-provided value.
  const triggerTrailing = control.pendingState
    ? <PendingConfigIndicator pendingState={control.pendingState} />
    : null;

  if (!control.settable) {
    return (
      <ComposerControlButton
        disabled
        emphasizeLabel={triggerStyle === "value"}
        icon={triggerIcon}
        label={visibleTriggerLabel}
        detail={visibleTriggerDetail}
        trailing={triggerTrailing}
        className="max-w-[12rem]"
        data-session-mode-trigger=""
        data-session-mode-selected={currentValue ?? ""}
      />
    );
  }

  const trigger = (
    <ComposerControlButton
      emphasizeLabel={triggerStyle === "value"}
      icon={triggerIcon}
      label={visibleTriggerLabel}
      detail={visibleTriggerDetail}
      trailing={triggerTrailing}
      title={`${CHAT_MODE_CONTROL_LABELS.cycleHint} (${CHAT_MODE_CONTROL_LABELS.shortcut})`}
      aria-label={`${control.label}: ${currentOption?.label ?? currentDetail ?? ""}`}
      className="max-w-[12rem]"
      data-session-mode-trigger=""
      data-session-mode-selected={currentValue ?? ""}
      data-session-mode-next={nextValue ?? ""}
      onClick={compactTrigger && nextValue
        ? () => control.onSelect(nextValue)
        : undefined}
    />
  );

  if (compactTrigger) {
    return trigger;
  }

  return (
    <PopoverButton
      trigger={trigger}
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
                data-session-mode-option={option.value}
                icon={<SessionControlIcon icon={presentation.icon} className="icon-paired text-muted-foreground [font-size:var(--text-composer)]" />}
                label={presentation.shortLabel ?? option.label}
                trailing={option.selected ? <Check className="icon-paired shrink-0 text-foreground/60" /> : null}
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
