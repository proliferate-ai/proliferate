import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { PendingPromptEntry } from "@anyharness/sdk";
import { Button } from "@/components/ui/Button";
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
} from "@/lib/domain/chat/subagents/provenance";
import {
  resolveOptimisticPromptActionTime,
} from "@/lib/domain/chat/transcript/transcript-action-time";
import {
  resolvePendingPromptTrailingStatus,
} from "@/components/workspace/chat/transcript/TranscriptTurnChrome";
import type { PromptOutboxEntry } from "@/lib/domain/chat/outbox/prompt-outbox-model";

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
      return entry.errorMessage ? `Not sent: ${entry.errorMessage}` : "Not sent";
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
