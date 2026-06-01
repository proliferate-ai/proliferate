import {
  Bot,
  Brain,
  Check,
  Clock3,
  Loader2,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import type { CloudChatComposerControlView } from "./CloudChatComposerView";
import { SessionControlIcon } from "../session-controls/SessionControlIcon";

export function ComposerControlMenuRows({
  control,
  showDescriptions = true,
  onClose,
}: {
  control: CloudChatComposerControlView;
  showDescriptions?: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {control.groups.flatMap((group) =>
        group.options.map((option) => (
          <PopoverMenuItem
            key={`${group.id}:${option.id}`}
            label={option.label}
            icon={option.icon ? <SessionControlIcon icon={option.icon} className="size-3.5" /> : undefined}
            trailing={(
              <span className="flex items-center gap-1">
                {option.selected ? <Check className="size-3.5 shrink-0" /> : null}
                {option.selected ? (
                  <PendingComposerConfigIndicator pendingState={control.pendingState ?? null} />
                ) : null}
              </span>
            )}
            disabled={option.disabled}
            onClick={() => {
              control.onSelect?.(option.id);
              onClose();
            }}
          >
            {showDescriptions ? option.description : null}
          </PopoverMenuItem>
        ))
      )}
    </>
  );
}

export function ComposerMenuSeparator() {
  return (
    <div className="w-full px-2 py-0.5">
      <div className="h-px w-full bg-border/60" />
    </div>
  );
}

export function PendingComposerConfigIndicator({
  pendingState,
}: {
  pendingState: CloudChatComposerControlView["pendingState"];
}) {
  if (pendingState === "sending") {
    return <Loader2 size={12} className="shrink-0 animate-spin text-muted-foreground/70" />;
  }
  if (pendingState === "queued") {
    return <Clock3 size={12} className="shrink-0 text-muted-foreground/70" />;
  }
  return null;
}

export function iconNodeForComposerControl(
  icon: CloudChatComposerControlView["icon"],
  className: string,
): ReactNode {
  switch (icon) {
    case "brain":
      return <Brain size={14} className={className} />;
    case "settings":
      return <Wrench size={14} className={className} />;
    case "bot":
      return <Bot size={14} className={className} />;
    case undefined:
    case null:
      return <Bot size={14} className={className} />;
    default:
      return <SessionControlIcon icon={icon} className={className} />;
  }
}
