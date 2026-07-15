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
/** Exact Codex conversation-item rhythm shared by pending and materialized turns. */
export const TURN_ITEM_GAP_CLASS = "gap-4";

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
  const copyContent = showCopyButton ? content : null;
  if (!copyContent && !reserveSlot) {
    return null;
  }

  const visibilityClassName = alwaysVisible
    ? "opacity-100"
    : "opacity-0 group-hover/turn:opacity-100";

  return (
    <div className="flex justify-start relative" data-turn-assistant-footer>
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
          />
        )}
        {copyContent && metMarker && (
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
        className={`gap-2 text-[length:var(--text-chat)] leading-[var(--text-chat--line-height)] text-muted-foreground ${ASSISTANT_ACTION_SLOT_HEIGHT}`}
      >
        <Sparkles className="size-[1.143em] shrink-0 text-current" />
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
