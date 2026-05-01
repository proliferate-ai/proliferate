import type { ReactNode } from "react";
import { CircleQuestion, Sparkles } from "@/components/ui/icons";
import { CopyMessageButton } from "@/components/workspace/chat/transcript/CopyMessageButton";
import { StreamingIndicator } from "@/components/workspace/chat/transcript/StreamingIndicator";
import type { SessionViewState } from "@/lib/domain/sessions/activity";

const TURN_HORIZONTAL_PADDING = "px-0";
const ASSISTANT_ACTION_SLOT_HEIGHT = "h-6";

/**
 * Minimum height for a turn that has no assistant text yet. Once prose exists,
 * the trailing status should stay compact instead of creating an empty block
 * between the prose and future tool activity.
 */
export const TRAILING_STATUS_MIN_HEIGHT =
  "min-h-[calc(var(--text-chat--line-height)+1.5rem)]";

export function TurnShell({
  children,
  isFirst = false,
}: {
  children: ReactNode;
  isFirst?: boolean;
}) {
  return (
    <div className={`${TURN_HORIZONTAL_PADDING} w-full max-w-full ${isFirst ? "pt-0" : "pt-2"} pb-2`}>
      {children}
    </div>
  );
}

export function TurnAssistantActionRow({
  content,
  showCopyButton = false,
  reserveSlot = false,
  timestampLabel = null,
}: {
  content: string | null;
  showCopyButton?: boolean;
  reserveSlot?: boolean;
  timestampLabel?: string | null;
}) {
  if (!content || (!showCopyButton && !reserveSlot)) {
    return null;
  }

  return (
    <div className="flex justify-start relative">
      <div className={`pl-1 pt-0.5 ${ASSISTANT_ACTION_SLOT_HEIGHT}`}>
        {showCopyButton && (
          <CopyMessageButton
            content={content}
            timestampLabel={timestampLabel}
            visibilityClassName="opacity-0 group-hover/turn:opacity-100"
          />
        )}
      </div>
    </div>
  );
}

export function resolvePendingPromptTrailingStatus(
  queuedAt: string,
  sessionViewState: SessionViewState,
  forceWorking: boolean,
): ReactNode {
  if (sessionViewState === "needs_input") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <CircleQuestion className="size-3.5 shrink-0 text-warning-foreground" />
        <span>Waiting for your input</span>
      </div>
    );
  }

  if (forceWorking || sessionViewState === "working") {
    return <StreamingIndicator startedAt={queuedAt} />;
  }

  return null;
}

export function resolveTurnTrailingStatus(
  startedAt: string,
  sessionViewState: SessionViewState,
  transientStatusText: string | null,
): ReactNode {
  if (sessionViewState === "working" && transientStatusText) {
    return (
      <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
        <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{transientStatusText}</span>
      </div>
    );
  }

  if (sessionViewState === "working") {
    return <StreamingIndicator startedAt={startedAt} />;
  }

  if (sessionViewState === "needs_input") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <CircleQuestion className="size-3.5 shrink-0 text-warning-foreground" />
        <span>Waiting for your input</span>
      </div>
    );
  }

  return null;
}
