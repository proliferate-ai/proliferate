import {
  resolveSessionControlTooltip,
  resolveSessionToggleControlPresentation,
  resolveSessionToggleControlStateIndicator,
} from "@/lib/domain/chat/session-toggle-control";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls";
import type { ConfiguredSessionControlKey } from "@/lib/domain/chat/session-controls/presentation";
import { Brain, Check, ChevronDown, Zap } from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/Tooltip";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { ComposerControlButton } from "./ComposerControlButton";
import { PendingConfigIndicator } from "./PendingConfigIndicator";
import { SessionModeControl } from "./SessionModeControl";
import { SessionReasoningEffortControl } from "./SessionReasoningEffortControl";

interface SessionConfigControlsProps {
  agentKind: string | null;
  controls: LiveSessionControlDescriptor[];
}

export function SessionConfigControls({ agentKind, controls }: SessionConfigControlsProps) {
  const uniqueControls = uniqueSessionControls(controls);

  return (
    <>
      {uniqueControls.map((control) => (
        isConfiguredModeControl(control) ? (
          <SessionModeControl key={control.key} agentKind={agentKind} control={control} />
        ) : control.key === "effort" ? (
          <SessionReasoningEffortControl key={control.key} control={control} />
        ) : control.kind === "toggle" ? (
          <ToggleControl key={control.key} control={control} />
        ) : (
          <SelectControl key={control.key} control={control} />
        )
      ))}
    </>
  );
}

function uniqueSessionControls(
  controls: LiveSessionControlDescriptor[],
): LiveSessionControlDescriptor[] {
  const controlsByKey = new Map<string, LiveSessionControlDescriptor>();
  const orderedKeys: string[] = [];

  for (const control of controls) {
    if (!controlsByKey.has(control.key)) {
      orderedKeys.push(control.key);
    }
    controlsByKey.set(control.key, control);
  }

  return orderedKeys
    .map((key) => controlsByKey.get(key))
    .filter((control): control is LiveSessionControlDescriptor => control !== undefined);
}

function isConfiguredModeControl(
  control: LiveSessionControlDescriptor,
): control is LiveSessionControlDescriptor & { key: ConfiguredSessionControlKey } {
  return control.key === "collaboration_mode" || control.key === "mode";
}

function ToggleControl({ control }: { control: LiveSessionControlDescriptor }) {
  const nextValue = control.isEnabled ? control.disabledValue : control.enabledValue;
  const selectedOption = control.options.find((option) => option.selected) ?? null;

  if (control.key === "reasoning" || control.key === "fast_mode") {
    const presentation = resolveSessionToggleControlPresentation(control.key);
    const Icon = presentation.icon === "brain" ? Brain : Zap;
    const indicator = resolveSessionToggleControlStateIndicator(control.key, !!control.isEnabled);
    const tooltip = resolveSessionControlTooltip(
      control.label,
      control.detail,
      selectedOption?.description,
    );
    const triggerLabel = control.key === "fast_mode" ? indicator.label : control.label;

    return (
      <Tooltip content={tooltip}>
        <ComposerControlButton
          disabled={!control.settable || !nextValue}
          tone={control.isEnabled ? presentation.tone : "quiet"}
          active={!!control.isEnabled}
          icon={<Icon className={`size-3.5 ${control.isEnabled ? "" : "opacity-65"}`} />}
          label={triggerLabel}
          trailing={<PendingConfigIndicator pendingState={control.pendingState} />}
          aria-label={tooltip}
          className="max-w-[12rem]"
          onClick={() => {
            if (nextValue) {
              control.onSelect(nextValue);
            }
          }}
        />
      </Tooltip>
    );
  }

  return (
    <ComposerControlButton
      disabled={!control.settable || !nextValue}
      tone={control.isEnabled ? "accent" : "neutral"}
      label={control.label}
      detail={control.detail}
      trailing={<PendingConfigIndicator pendingState={control.pendingState} />}
      className="max-w-[12rem]"
      onClick={() => {
        if (nextValue) {
          control.onSelect(nextValue);
        }
      }}
    />
  );
}

function SelectControl({ control }: { control: LiveSessionControlDescriptor }) {
  if (!control.settable) {
    return (
      <ComposerControlButton
        disabled
        tone="quiet"
        label={control.label}
        detail={control.detail}
      />
    );
  }

  return (
    <PopoverButton
      trigger={
        <ComposerControlButton
          label={control.label}
          detail={control.detail}
          trailing={
            <span className="flex items-center gap-1">
              <PendingConfigIndicator pendingState={control.pendingState} />
              <ChevronDown className="size-3 text-[color:var(--color-composer-control-muted-foreground)]" />
            </span>
          }
          className="max-w-[14rem]"
        />
      }
      side="top"
      className="w-56 rounded-xl border border-border bg-popover p-1 shadow-floating"
    >
      {(close) => (
        <>
          {control.options.map((option) => (
            <PopoverMenuItem
              key={option.value}
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
