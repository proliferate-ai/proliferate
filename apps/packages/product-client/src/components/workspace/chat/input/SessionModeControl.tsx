import { CHAT_MODE_CONTROL_LABELS } from "#product/copy/chat/chat-copy";
import {
  COMPOSER_COMPACT_HIDDEN_CLASSNAME,
  COMPOSER_COMPACT_ONLY_FLEX_CLASSNAME,
  COMPOSER_COMPACT_SHRINK_NONE_CLASSNAME,
} from "#product/config/chat-layout";
import {
  getNextSessionModeValue,
  resolveSessionControlPresentation,
} from "#product/lib/domain/chat/session-controls/session-mode-control";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import type { ConfiguredSessionControlKey } from "#product/lib/domain/chat/session-controls/presentation";
import { SessionControlIcon } from "#product/components/workspace/chat/session-controls/SessionControlIcon";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "#product/primitives/PopoverButton";
import { Check } from "#product/primitives/icons/core";
import { PopoverMenuItem } from "#product/primitives/PopoverMenuItem";
import { ComposerControlButton } from "#product/primitives/patterns/ComposerControlButton";
import { AnimatedSwapText } from "#product/primitives/AnimatedSwapText";
import { PendingConfigIndicator } from "#product/components/workspace/chat/input/PendingConfigIndicator";

type ModeControlDescriptor = LiveSessionControlDescriptor & {
  key: ConfiguredSessionControlKey;
};

interface SessionModeControlProps {
  agentKind: string | null;
  control: ModeControlDescriptor;
  triggerStyle?: "full" | "value";
  /** Merged onto the trigger button (e.g. the disabled-state opacity). */
  className?: string;
}

export function SessionModeControl({
  agentKind,
  control,
  triggerStyle = "full",
  className = "",
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
  // The value-style trigger has no leading icon at full width, but below the
  // composer's compact container tier it swaps the mode name for the mode
  // icon so the pill keeps a fixed icon footprint instead of truncating
  // mid-word. Modes without a configured icon keep their text at every width.
  const swapsToIconWhenCompact = compactTrigger && currentPresentation.icon !== null;
  const triggerIcon = compactTrigger && !swapsToIconWhenCompact
    ? undefined
    : <SessionControlIcon icon={currentPresentation.icon} className="icon-control [font-size:var(--text-body)]" />;
  const compactSwapProps = swapsToIconWhenCompact
    ? {
      iconWrapperClassName: COMPOSER_COMPACT_ONLY_FLEX_CLASSNAME,
      labelWrapperClassName: COMPOSER_COMPACT_HIDDEN_CLASSNAME,
    }
    : {};
  const triggerClassName = `max-w-[12rem] ${
    swapsToIconWhenCompact ? COMPOSER_COMPACT_SHRINK_NONE_CLASSNAME : ""
  } ${className}`;
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
        className={triggerClassName}
        {...compactSwapProps}
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
      className={triggerClassName}
      {...compactSwapProps}
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
                icon={<SessionControlIcon icon={presentation.icon} className="icon-paired text-muted-foreground [font-size:var(--text-body)]" />}
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
