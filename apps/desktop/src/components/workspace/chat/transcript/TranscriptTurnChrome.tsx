import type { ReactNode } from "react";
// CircleCheck isn't in the curated @proliferate/ui/icons set — the goal bar
// and goal transcript rows source it directly from lucide-react too.
import { CircleCheck } from "lucide-react";
import {
  CircleQuestion,
  MessageCircleQuestion,
  Sparkles,
} from "@proliferate/ui/icons";
import type { PendingInteraction } from "@anyharness/sdk";
import { CopyMessageButton } from "@/components/workspace/chat/transcript/CopyMessageButton";
import { StreamingIndicator } from "@/components/workspace/chat/transcript/StreamingIndicator";
import { CHAT_STREAMING_STATUS_LABELS } from "@/copy/chat/chat-copy";
import { useActivePendingInteractionState } from "@/hooks/chat/derived/use-active-pending-session-interactions";
import type { SessionViewState } from "@proliferate/product-domain/sessions/activity";

/**
 * The two interaction shapes that get a distinct transcript marker while the
 * agent waits on the user: a tool/plan approval (Permission) and an
 * AskUserQuestion / MCP elicitation (Question). Threaded from the composer's
 * primary pending interaction; null when the kind is unknown (e.g. plan-owned).
 */
export type PendingInteractionMarkerKind = "permission" | "question";

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
  const verticalPadding = `${isFirst ? "pt-0" : "pt-2"} pb-2`;
  return (
    <div className={`${TURN_HORIZONTAL_PADDING} w-full max-w-full ${verticalPadding}`}>
      {children}
    </div>
  );
}

export function TurnAssistantActionRow({
  content,
  showCopyButton = false,
  reserveSlot = false,
  timestampLabel = null,
  alwaysVisible = false,
  metMarker = null,
}: {
  content: string | null;
  showCopyButton?: boolean;
  reserveSlot?: boolean;
  timestampLabel?: string | null;
  /**
   * When true the copy/action row is persistently visible (opacity-100)
   * instead of hover-gated. Set only for the transcript's final completed AI
   * message; every earlier message keeps hover-to-reveal.
   */
  alwaysVisible?: boolean;
  /**
   * Inline "✓ Goal achieved in Xs" marker rendered between the copy button
   * and the timestamp — only on the final completed message when the active
   * session's goal is currently met.
   */
  metMarker?: ReactNode;
}) {
  if (!content || (!showCopyButton && !reserveSlot)) {
    return null;
  }

  const visibilityClassName = alwaysVisible
    ? "opacity-100"
    : "opacity-0 group-hover/turn:opacity-100";

  return (
    <div className="flex justify-start relative">
      <div className={`flex items-center gap-2 pt-0.5 ${ASSISTANT_ACTION_SLOT_HEIGHT}`}>
        {showCopyButton && (
          <CopyMessageButton
            content={content}
            timestampLabel={metMarker ? null : timestampLabel}
            timestampPosition="after"
            visibilityClassName={visibilityClassName}
          />
        )}
        {metMarker && (
          <>
            <span aria-hidden className="h-3 w-px bg-border/60" />
            {metMarker}
            {timestampLabel && (
              <span className="text-[length:var(--text-chat-meta,11px)] text-muted-foreground tabular-nums">
                {timestampLabel}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function TurnLiveTailSlot({ children }: { children: ReactNode }) {
  return (
    <div className={`flex items-center ${ASSISTANT_ACTION_SLOT_HEIGHT}`} data-turn-tail-slot>
      {children}
    </div>
  );
}

/**
 * Inline "✓ Goal achieved in Xs" marker for the final completed message's
 * action footer (Fix 3). Matches the action-row typography (text-chat-meta,
 * muted-foreground) with a small neutral check glyph.
 */
export function TurnGoalMetMarker({ label }: { label: string }): ReactNode {
  return (
    <span className="inline-flex items-center gap-1 text-[length:var(--text-chat-meta,11px)] text-muted-foreground">
      <CircleCheck className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      {label}
    </span>
  );
}

export function resolvePendingPromptTrailingStatus(
  queuedAt: string,
  sessionViewState: SessionViewState,
  forceWorking: boolean,
): ReactNode {
  if (sessionViewState === "needs_input") {
    return (
      <TrailingStatusCrossfade statusKey="needs-input">
        <ConnectedPendingInteractionMarker />
      </TrailingStatusCrossfade>
    );
  }

  if (forceWorking || sessionViewState === "working") {
    // Outbox / launch dispatch — same "Thinking" voice as agent work (the
    // send/queue distinction is plumbing, not something the user tracks).
    return (
      <TrailingStatusCrossfade statusKey="sending">
        <StreamingIndicator startedAt={queuedAt} label={CHAT_STREAMING_STATUS_LABELS.sending} />
      </TrailingStatusCrossfade>
    );
  }

  return null;
}

export function resolveTurnTrailingStatus(
  startedAt: string,
  sessionViewState: SessionViewState,
  transientStatusText: string | null,
): ReactNode {
  // Every variant renders inside the same fixed-height row as the reserved
  // assistant action slot, so swapping between "Thinking…", a transient status,
  // and the needs-input marker never shifts the content above it. The three
  // states share one crossfade container: a state change fades the new content
  // in over 150ms (opacity only) instead of a hard swap.
  if (sessionViewState === "working" && transientStatusText) {
    return (
      <TrailingStatusCrossfade
        statusKey="transient"
        className={`gap-2 text-[length:var(--text-chat)] leading-[var(--text-chat--line-height)] text-muted-foreground ${ASSISTANT_ACTION_SLOT_HEIGHT}`}
      >
        <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{transientStatusText}</span>
      </TrailingStatusCrossfade>
    );
  }

  if (sessionViewState === "working") {
    return (
      <TrailingStatusCrossfade statusKey="working" className={ASSISTANT_ACTION_SLOT_HEIGHT}>
        <StreamingIndicator startedAt={startedAt} />
      </TrailingStatusCrossfade>
    );
  }

  if (sessionViewState === "needs_input") {
    return (
      <TrailingStatusCrossfade statusKey="needs-input" className={ASSISTANT_ACTION_SLOT_HEIGHT}>
        <ConnectedPendingInteractionMarker />
      </TrailingStatusCrossfade>
    );
  }

  return null;
}

// Single container for the three trailing states. `key` forces a remount on a
// real state change (the crossfade replays), while same-state re-renders — the
// elapsed second ticking, a transient string re-wording — reconcile in place
// with no re-animation. Compositor-only (opacity), motion-safe.
function TrailingStatusCrossfade({
  statusKey,
  className,
  children,
}: {
  statusKey: string;
  className?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div
      key={statusKey}
      data-trailing-status={statusKey}
      className={`flex items-center motion-safe:animate-status-crossfade ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

// Reads the composer's primary pending interaction so the transcript marker can
// name WHAT is awaiting the user (Permission vs Question) rather than a generic
// "waiting" row. Kept a thin wrapper so the presentation stays pure/testable.
function ConnectedPendingInteractionMarker(): ReactNode {
  const { primaryPendingInteraction } = useActivePendingInteractionState();
  return (
    <PendingInteractionMarkerView
      kind={pendingInteractionMarkerKind(primaryPendingInteraction?.kind)}
    />
  );
}

export function pendingInteractionMarkerKind(
  interactionKind: PendingInteraction["kind"] | undefined,
): PendingInteractionMarkerKind | null {
  if (interactionKind === "permission") {
    return "permission";
  }
  if (interactionKind === "user_input" || interactionKind === "mcp_elicitation") {
    return "question";
  }
  return null;
}

// Superset-style two-part marker: a kind icon + label, then an "Awaiting
// response" caption. Replaces the old 8px CircleQuestion "Waiting for your
// input" row.
export function PendingInteractionMarkerView({
  kind,
}: {
  kind: PendingInteractionMarkerKind | null;
}): ReactNode {
  const { Icon, label } =
    kind === "permission"
      ? { Icon: MessageCircleQuestion, label: "Permission" }
      : kind === "question"
        ? { Icon: MessageCircleQuestion, label: "Question" }
        : { Icon: CircleQuestion, label: null };

  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      {label && (
        <span className="text-[length:var(--text-chat)] leading-[var(--text-chat--line-height)] font-medium text-foreground">
          {label}
        </span>
      )}
      <span className="text-[length:var(--text-chat)] leading-[var(--text-chat--line-height)] uppercase tracking-wide text-muted-foreground">
        Awaiting response
      </span>
    </div>
  );
}
