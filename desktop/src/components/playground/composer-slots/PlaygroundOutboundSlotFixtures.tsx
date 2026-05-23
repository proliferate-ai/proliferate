import type { ReactNode } from "react";
import { PendingPromptList } from "@/components/workspace/chat/input/PendingPromptList";
import type { ScenarioKey } from "@/config/playground";
import {
  PENDING_PROMPTS_MULTI,
  PENDING_PROMPTS_SINGLE,
  PENDING_PROMPTS_WITH_EDITING,
  PENDING_REVIEW_COMPLETE,
  PENDING_REVIEW_FEEDBACK_READY,
} from "@/lib/domain/chat/__fixtures__/playground/outbound-slot-fixtures";
import {
  PLAYGROUND_SUBAGENT_WAKE_QUEUE,
} from "@/lib/domain/chat/__fixtures__/playground/tool-transcript-fixtures";
import {
  derivePendingPromptQueueRow,
  type PendingPromptQueueEntry,
} from "@proliferate/product-model/chats/pending-prompts/pending-prompt-queue";
import { noop } from "@/components/playground/PlaygroundComposerActions";

export function renderOutboundSlot(scenario: ScenarioKey): ReactNode | null {
  switch (scenario) {
    case "pending-prompts-single":
    case "pending-prompts-with-approval":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PENDING_PROMPTS_SINGLE)}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    case "pending-prompts-multi":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PENDING_PROMPTS_MULTI)}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    case "pending-prompts-editing":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PENDING_PROMPTS_WITH_EDITING)}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    case "pending-review-feedback-ready":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PENDING_REVIEW_FEEDBACK_READY)}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    case "pending-review-complete":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PENDING_REVIEW_COMPLETE)}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    case "subagents-queued-wake":
    case "subagents-queued-wake-with-approval":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PLAYGROUND_SUBAGENT_WAKE_QUEUE)}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    default:
      return null;
  }
}

function pendingQueueRows(entries: PendingPromptQueueEntry[]) {
  return entries.map(derivePendingPromptQueueRow);
}
