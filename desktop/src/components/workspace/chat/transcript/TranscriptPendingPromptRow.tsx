import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { PendingPromptEntry } from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { ReviewFeedbackSummary } from "@/components/workspace/reviews/ReviewFeedbackSummary";
import { SubagentWakeBadge } from "./SubagentWakeBadge";
import { UserMessage } from "./UserMessage";
import {
  TRAILING_STATUS_MIN_HEIGHT,
  TurnShell,
} from "./TranscriptTurnChrome";
import {
  isSubagentWakeProvenance,
  resolveReviewFeedbackPromptReference,
} from "@proliferate/product-model/chats/subagents/provenance";
import {
  resolveOptimisticPromptActionTime,
} from "@proliferate/product-model/chats/transcript/transcript-action-time";
import {
  resolvePendingPromptTrailingStatus,
} from "@/components/workspace/chat/transcript/TranscriptTurnChrome";
import type { PromptOutboxEntry } from "@/lib/domain/sessions/intents/session-intent-model";

const OUTBOX_ACCEPTED_RUNNING_ECHO_GRACE_MS = 15_000;

interface OutboxActionHandlers {
  retryPrompt: (clientPromptId: string) => void;
  dismissPrompt: (clientPromptId: string) => void;
}

export function TranscriptPendingPromptRow({
  activeSessionId,
  rowIndex,
  prompt,
  outboxEntry,
  optimisticTrailingStatus,
  outboxActions,
}: {
  activeSessionId: string;
  rowIndex: number;
  prompt: PendingPromptEntry;
  outboxEntry: PromptOutboxEntry | null;
  optimisticTrailingStatus: ReactNode;
  outboxActions: OutboxActionHandlers;
}) {
  if (outboxEntry?.deliveryState === "failed_before_dispatch") {
    return (
      <TurnShell isFirst={rowIndex === 0}>
        <OutboxPromptFailureLine
          entry={outboxEntry}
          outboxActions={outboxActions}
        />
      </TurnShell>
    );
  }

  const trailingStatus = outboxEntry
    ? <OutboxPromptTrailingStatus entry={outboxEntry} />
    : optimisticTrailingStatus;
  const outboxControls = outboxEntry
    ? renderOutboxPromptControls(outboxEntry, outboxActions)
    : null;

  return (
    <TurnShell isFirst={rowIndex === 0}>
      <div className="flex flex-col gap-2">
        <PendingPromptBody
          activeSessionId={activeSessionId}
          prompt={prompt}
        />
        {trailingStatus && (
          <div className={TRAILING_STATUS_MIN_HEIGHT}>{trailingStatus}</div>
        )}
        {outboxControls}
      </div>
    </TurnShell>
  );
}

function PendingPromptBody({
  activeSessionId,
  prompt,
}: {
  activeSessionId: string;
  prompt: PendingPromptEntry;
}) {
  const reviewFeedbackReference = resolveReviewFeedbackPromptReference(
    prompt.promptProvenance,
    prompt.text,
  );
  if (isSubagentWakeProvenance(prompt.promptProvenance)) {
    return (
      <div className="flex justify-end">
        <SubagentWakeBadge
          label={prompt.promptProvenance.label ?? null}
        />
      </div>
    );
  }
  if (reviewFeedbackReference) {
    return (
      <ReviewFeedbackSummary
        reference={reviewFeedbackReference}
        sessionId={activeSessionId}
        state="queued"
      />
    );
  }
  return (
    <UserMessage
      sessionId={activeSessionId}
      content={prompt.text}
      contentParts={prompt.contentParts}
      showCopyButton
      timestampLabel={resolveOptimisticPromptActionTime(prompt)}
    />
  );
}

function OutboxPromptTrailingStatus({ entry }: { entry: PromptOutboxEntry | null }) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (entry?.deliveryState !== "accepted_running") {
      return;
    }
    const acceptedAtMs = resolveOutboxAcceptedRunningReferenceMs(entry);
    const remainingMs = OUTBOX_ACCEPTED_RUNNING_ECHO_GRACE_MS - (Date.now() - acceptedAtMs);
    if (remainingMs <= 0) {
      setNowMs(Date.now());
      return;
    }
    const timeout = window.setTimeout(() => {
      setNowMs(Date.now());
    }, remainingMs + 50);
    return () => window.clearTimeout(timeout);
  }, [
    entry?.acceptedAt,
    entry?.clientPromptId,
    entry?.createdAt,
    entry?.deliveryState,
    entry?.dispatchedAt,
  ]);

  return <>{resolveOutboxPromptTrailingStatus(entry, nowMs)}</>;
}

function resolveOutboxPromptTrailingStatus(
  entry: PromptOutboxEntry | null,
  nowMs = Date.now(),
): ReactNode {
  if (!entry) {
    return null;
  }
  switch (entry.deliveryState) {
    case "failed_before_dispatch":
      return formatOutboxPromptFailureLabel(entry);
    case "unknown_after_dispatch":
      return "Waiting for confirmation…";
    case "preparing":
    case "dispatching":
    case "waiting_for_session":
      return resolvePendingPromptTrailingStatus(entry.createdAt, "working", true);
    case "accepted_running":
      if (hasAcceptedRunningOutboxEntryExceededEchoGrace(entry, nowMs)) {
        return "Waiting for transcript…";
      }
      return resolvePendingPromptTrailingStatus(entry.createdAt, "working", true);
    default:
      return null;
  }
}

function OutboxPromptFailureLine({
  entry,
  outboxActions,
}: {
  entry: PromptOutboxEntry;
  outboxActions: OutboxActionHandlers;
}) {
  const canRetry = !isSessionClosedFailure(entry.errorMessage);

  return (
    <div className="flex justify-end">
      <div
        data-chat-transcript-ignore
        className="inline-flex max-w-[77%] items-center gap-2 overflow-hidden whitespace-nowrap text-[length:var(--text-chat)] font-normal leading-[var(--text-chat--line-height)] text-muted-foreground/80"
      >
        <span className="min-w-0 truncate" title={formatOutboxPromptFailureLabel(entry)}>
          <span className="text-destructive/80">Not sent</span>
          {entry.errorMessage ? (
            <span>: {entry.errorMessage}</span>
          ) : null}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1">
          {canRetry && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto rounded-none px-1 py-0 text-[11px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground focus-visible:ring-0 focus-visible:underline"
              onClick={() => outboxActions.retryPrompt(entry.clientPromptId)}
            >
              Retry
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto rounded-none px-1 py-0 text-[11px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground focus-visible:ring-0 focus-visible:underline"
            onClick={() => outboxActions.dismissPrompt(entry.clientPromptId)}
          >
            Dismiss
          </Button>
        </span>
      </div>
    </div>
  );
}

function formatOutboxPromptFailureLabel(entry: PromptOutboxEntry): string {
  return entry.errorMessage ? `Not sent: ${entry.errorMessage}` : "Not sent";
}

function isSessionClosedFailure(message: string | null): boolean {
  return message
    ?.replace(/\s+/gu, " ")
    .trim()
    .toLowerCase() === "session is closed";
}

function hasAcceptedRunningOutboxEntryExceededEchoGrace(
  entry: PromptOutboxEntry,
  nowMs: number,
): boolean {
  return nowMs - resolveOutboxAcceptedRunningReferenceMs(entry)
    >= OUTBOX_ACCEPTED_RUNNING_ECHO_GRACE_MS;
}

function resolveOutboxAcceptedRunningReferenceMs(entry: PromptOutboxEntry): number {
  const parsed = Date.parse(entry.acceptedAt ?? entry.dispatchedAt ?? entry.createdAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function renderOutboxPromptControls(
  entry: PromptOutboxEntry,
  actions: OutboxActionHandlers,
): ReactNode {
  if (entry.deliveryState === "failed_before_dispatch") {
    return (
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-chat-transcript-ignore
          onClick={() => actions.retryPrompt(entry.clientPromptId)}
        >
          Retry
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-chat-transcript-ignore
          onClick={() => actions.dismissPrompt(entry.clientPromptId)}
        >
          Dismiss
        </Button>
      </div>
    );
  }

  if (entry.deliveryState === "unknown_after_dispatch") {
    return (
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-chat-transcript-ignore
          onClick={() => actions.dismissPrompt(entry.clientPromptId)}
        >
          Dismiss
        </Button>
      </div>
    );
  }

  return null;
}
