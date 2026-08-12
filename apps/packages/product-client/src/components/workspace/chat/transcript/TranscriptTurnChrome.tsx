import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  CircleQuestion,
  MessageCircleQuestion,
} from "#product/primitives/icons/core";
import { Sparkles } from "#product/primitives/icons/product";
import { CircleCheck } from "#product/primitives/icons/status";
import type { PendingInteraction, TurnRecord } from "@anyharness/sdk";
import { formatWorkedForDuration } from "#product/domain/chats/transcript/transcript-work-duration";
import { CopyMessageButton } from "#product/components/workspace/chat/transcript/CopyMessageButton";
import { StreamingIndicator } from "#product/components/workspace/chat/transcript/StreamingIndicator";
import { CHAT_STREAMING_STATUS_LABELS } from "#product/copy/chat/chat-copy";
import { useActivePendingInteractionState } from "#product/hooks/chat/derived/use-active-pending-session-interactions";
import type { SessionViewState } from "#product/domain/sessions/activity";

/**
 * The two interaction shapes that get a distinct transcript marker while the
 * agent waits on the user: a tool/plan approval (Permission) and an
 * AskUserQuestion / MCP elicitation (Question). Threaded from the composer's
 * primary pending interaction; null when the kind is unknown (e.g. plan-owned).
 */
export type PendingInteractionMarkerKind = "permission" | "question";

const TURN_HORIZONTAL_PADDING = "px-0";
/**
 * Fixed height shared by every trailing-status variant AND the reserved
 * frontier keeper in TranscriptTurnRow: the status content may mount and
 * unmount mid-turn (Thinking yields to tool shimmers and returns), but the
 * box it lives in must not change size, or the transcript bottom bounces.
 */
export const ASSISTANT_ACTION_SLOT_HEIGHT = "h-6";
/**
 * Reference-ramp conversation-item rhythm shared by pending and materialized
 * turns. [CHAT-04] RULED block, retuned: that rhythm is the 16px
 * `--spacing-transcript-turn` token, not a raw `gap-4` utility. This constant
 * is the LIVE transcript's turn stack — every real chat surface (MessageList
 * → TurnItemSequence, TranscriptTurnRow, TranscriptPendingPromptRow,
 * ToolCallSummary, ChatLaunchIntentPane) reads it — so the token has to land
 * here and not only in the playground-only CloudChatTranscriptRows.
 */
export const TURN_ITEM_GAP_CLASS = "gap-transcript-turn";

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
  metMarker = null,
}: {
  content: string | null;
  showCopyButton?: boolean;
  reserveSlot?: boolean;
  timestampLabel?: string | null;
  /**
   * Inline "✓ Goal achieved in Xs" marker rendered between the copy button
   * and the timestamp — only on the final completed message when the active
   * session's goal is currently met.
   */
  metMarker?: ReactNode;
}) {
  const copyContent = showCopyButton ? content : null;
  if (!copyContent && !reserveSlot) {
    return null;
  }

  // Hover-to-reveal on EVERY message, including the final one — the copy
  // button is never permanent chrome. (The goal-met marker below stays
  // persistently visible; it reports state rather than offering an action.)
  const visibilityClassName =
    "opacity-0 group-hover/turn:opacity-100 group-focus-within/turn:opacity-100";
  const timestampVisibilityClassName = visibilityClassName;

  return (
    // The footer sits in the same TURN_ITEM_GAP_CLASS flex column as the
    // prose above it, so it inherits the full 16px --spacing-transcript-turn
    // gap. Pulling it up by (16px - 4px) nets the tight 4px
    // --spacing-transcript-turn-tight rhythm for this closely-related
    // prose/action pair, instead of the turn-to-turn 16px.
    <div className="relative -mt-3 flex justify-start" data-turn-assistant-footer>
      <div
        className={`flex items-center gap-2 pt-0.5 ${ASSISTANT_ACTION_SLOT_HEIGHT}`}
        data-turn-assistant-footer-slot
      >
        {copyContent && (
          <CopyMessageButton
            content={copyContent}
            timestampLabel={metMarker ? null : timestampLabel}
            timestampPosition="after"
            visibilityClassName={visibilityClassName}
            timestampVisibilityClassName={timestampVisibilityClassName}
          />
        )}
        {copyContent && metMarker && (
          <>
            <span aria-hidden className="h-3 w-px bg-border/60" />
            {metMarker}
            {timestampLabel && (
              // Hover-gated like every message's timestamp, so the date
              // never sits as permanent chrome next to the goal-met marker.
              <span
                className={`text-chat-meta text-foreground-tertiary tabular-nums transition-opacity duration-hover ${timestampVisibilityClassName}`}
              >
                {timestampLabel}
              </span>
            )}
          </>
        )}
      </div>
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
    <span className="inline-flex items-center gap-1 text-ui-sm text-muted-foreground">
      <CircleCheck className="icon-compact shrink-0 text-muted-foreground [font-size:var(--text-chat)]" aria-hidden />
      {label}
    </span>
  );
}

// One-shot flag for the completed-history disclosure's entry animation: only
// a live streaming→settled transition animates; mounting an already-settled
// turn (history load, row remount) does not. Shared by the real disclosure in
// TurnItemSequence and the synthesized one in TurnWorkspaceReceiptSlot.
export function useCompletedHistoryTransition(eligible: boolean): boolean {
  const wasEligibleRef = useRef(eligible);
  const [transitionClaimed, setTransitionClaimed] = useState(false);

  useLayoutEffect(() => {
    if (eligible && !wasEligibleRef.current) {
      setTransitionClaimed(true);
    }
    wasEligibleRef.current = eligible;
  }, [eligible]);

  return transitionClaimed;
}

export function CompletedHistorySequence({ children }: { children: ReactNode }) {
  return (
    <div
      data-completed-history-sequence
      className={`flex flex-col ${TURN_ITEM_GAP_CLASS}`}
    >
      {children}
    </div>
  );
}

export function resolveCompletedHistoryDisclosureLabel(
  turn: Pick<TurnRecord, "startedAt" | "completedAt">,
  override: string | null | undefined,
): string {
  return override
    ?? formatWorkedForDuration(turn.startedAt, turn.completedAt)
    ?? "Worked";
}

export function resolvePendingPromptTrailingStatus(
  queuedAt: string,
  sessionViewState: SessionViewState,
  forceWorking: boolean,
): ReactNode {
  if (sessionViewState === "needs_input") {
    return (
      <TrailingStatusCrossfade statusKey="needs-input" className={ASSISTANT_ACTION_SLOT_HEIGHT}>
        <ConnectedPendingInteractionMarker />
      </TrailingStatusCrossfade>
    );
  }

  if (forceWorking || sessionViewState === "working") {
    // Outbox / launch dispatch — same "Thinking" voice as agent work (the
    // send/queue distinction is plumbing, not something the user tracks).
    return renderWorkingTrailingStatus(
      "sending",
      queuedAt,
      CHAT_STREAMING_STATUS_LABELS.sending,
    );
  }

  return null;
}

export function resolveTurnTrailingStatus(
  startedAt: string,
  sessionViewState: SessionViewState,
  transientStatusText: string | null,
): ReactNode {
  // Every status variant has fixed-height frontier geometry above the separate
  // assistant footer. Transient and blocking markers fade in; the phase-anchored
  // working gleam renders directly so an owner handoff cannot replay a one-shot
  // parent animation.
  if (sessionViewState === "working" && transientStatusText) {
    return (
      <TrailingStatusCrossfade
        statusKey="transient"
        className={`gap-2 text-chat text-muted-foreground ${ASSISTANT_ACTION_SLOT_HEIGHT}`}
      >
        <Sparkles className="icon-paired shrink-0 text-current" />
        <span className="min-w-0 truncate">{transientStatusText}</span>
      </TrailingStatusCrossfade>
    );
  }

  if (sessionViewState === "working") {
    // The gleam carries its own motion and is phase-anchored to startedAt.
    // Avoid a one-shot parent fade that would visibly replay when the pending
    // prompt hands this slot to the materialized turn.
    return renderWorkingTrailingStatus("working", startedAt);
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

function renderWorkingTrailingStatus(
  status: "sending" | "working",
  startedAt: string,
  label?: string,
): ReactNode {
  return (
    <div
      className={`flex items-center ${ASSISTANT_ACTION_SLOT_HEIGHT}`}
      data-trailing-status={status}
      data-working-status-frame
    >
      <StreamingIndicator startedAt={startedAt} label={label} />
    </div>
  );
}

// One-shot container for transient and blocking trailing states. Same-state
// re-renders reconcile in place. The working gleam deliberately bypasses this
// wrapper so pending→turn ownership changes remain visually continuous.
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
      <Icon className="icon-paired shrink-0 [font-size:var(--text-chat)]" />
      {label && (
        <span className="text-chat font-medium text-foreground">
          {label}
        </span>
      )}
      <span className="text-chat uppercase tracking-wide text-muted-foreground">
        Awaiting response
      </span>
    </div>
  );
}
