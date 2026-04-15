import { type ComponentType } from "react";
import { CHAT_MODE_CONTROL_LABELS } from "@/config/chat";
import {
  resolveSessionControlPresentation,
  type SessionModeIconKey,
} from "@/lib/domain/chat/session-mode-control";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls";
import { PopoverButton } from "@/components/ui/PopoverButton";
import {
  Check,
  ChevronDown,
  CircleQuestion,
  Pencil,
  PlanningIcon,
  Shield,
  Zap,
} from "@/components/ui/icons";
import { ComposerControlButton } from "./ComposerControlButton";
import { PendingConfigIndicator } from "./PendingConfigIndicator";

interface SessionModeControlProps {
  agentKind: string | null;
  control: LiveSessionControlDescriptor;
}

const MODE_ICONS: Record<SessionModeIconKey, ComponentType<{ className?: string }>> = {
  circleQuestion: CircleQuestion,
  pencil: Pencil,
  planning: PlanningIcon,
  shield: Shield,
  zap: Zap,
};

const POPOVER_ROW =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground hover:bg-accent";

export function SessionModeControl({ agentKind, control }: SessionModeControlProps) {
  const currentOption = control.options.find((option) => option.selected) ?? null;
  const currentValue = currentOption?.value ?? null;
  const currentPresentation = resolveSessionControlPresentation(
    agentKind,
    "collaboration_mode",
    currentValue,
  );
  const currentDetail = currentPresentation.shortLabel ?? currentOption?.label ?? control.detail;

  if (!control.settable) {
    return (
      <ComposerControlButton
        disabled
        tone={currentPresentation.tone}
        icon={renderModeGlyph(currentPresentation.icon, "size-3.5")}
        label={control.label}
        detail={currentDetail}
        trailing={<PendingConfigIndicator pendingState={control.pendingState} />}
        className="max-w-[12rem]"
      />
    );
  }

  return (
    <PopoverButton
      trigger={
        <ComposerControlButton
          tone={currentPresentation.tone}
          icon={renderModeGlyph(currentPresentation.icon, "size-3.5")}
          label={control.label}
          detail={currentDetail}
          trailing={
            <span className="flex items-center gap-1">
              <PendingConfigIndicator pendingState={control.pendingState} />
              <ChevronDown className="size-3 shrink-0 text-[color:var(--color-composer-control-muted-foreground)]" />
            </span>
          }
          title={`${CHAT_MODE_CONTROL_LABELS.cycleHint} (${CHAT_MODE_CONTROL_LABELS.shortcut})`}
          aria-label={`${control.label}: ${currentOption?.label ?? currentDetail ?? ""}`}
          className="max-w-[12rem]"
        />
      }
      side="top"
      className="w-56 rounded-xl border border-border bg-popover p-1 shadow-floating"
    >
      {(close) => (
        <>
          {control.options.map((option) => {
            const presentation = resolveSessionControlPresentation(
              agentKind,
              "collaboration_mode",
              option.value,
            );
            const Icon = MODE_ICONS[presentation.icon];
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  control.onSelect(option.value);
                  close();
                }}
                className={POPOVER_ROW}
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-left">
                  {presentation.shortLabel ?? option.label}
                </span>
                {option.selected && <Check className="size-3.5 shrink-0 text-foreground/60" />}
              </button>
            );
          })}
        </>
      )}
    </PopoverButton>
  );
}

function renderModeGlyph(icon: SessionModeIconKey, className: string) {
  const Icon = MODE_ICONS[icon];
  return <Icon className={className} />;
}
