import type { ReactNode } from "react";
import { PendingPromptList } from "#product/components/workspace/chat/input/PendingPromptList";
import type { ScenarioKey } from "#product/config/playground";
import {
  PENDING_PROMPTS_MULTI,
  PENDING_PROMPTS_SINGLE,
  PENDING_PROMPTS_WITH_EDITING,
} from "#product/lib/domain/chat/__fixtures__/playground/outbound-slot-fixtures";
import {
  PLAYGROUND_SUBAGENT_WAKE_TRANSCRIPT,
  PLAYGROUND_SUBAGENT_WAKE_QUEUE,
} from "#product/lib/domain/chat/__fixtures__/playground/subagent-wake-transcript-fixtures";
import {
  derivePendingPromptQueueRow,
  derivePendingPromptQueueRows,
  type PendingPromptQueueEntry,
} from "#product/domain/chats/pending-prompts/pending-prompt-queue";
import { noop } from "#product/components/playground/PlaygroundComposerActions";
import {
  PLAYGROUND_AGENT_OPERATIONS_PENDING_COMPLETIONS,
  PLAYGROUND_AGENT_OPERATIONS_PENDING_ENTRIES,
} from "#product/lib/domain/chat/__fixtures__/playground/agent-operations-transcript-fixtures";

export function renderOutboundSlot(scenario: ScenarioKey): ReactNode | null {
  switch (scenario) {
    case "pending-prompts-single":
    case "pending-prompts-with-approval":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PENDING_PROMPTS_SINGLE)}
          steeringSeq={null}
          sessionMaterialized
          queueMutationInFlight={false}
          onBeginEdit={noop}
          onDelete={noop}
          onSteer={noop}
          onReorder={noop}
        />
      );
    case "pending-prompts-multi":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PENDING_PROMPTS_MULTI)}
          steeringSeq={null}
          sessionMaterialized
          queueMutationInFlight={false}
          onBeginEdit={noop}
          onDelete={noop}
          onSteer={noop}
          onReorder={noop}
        />
      );
    case "pending-prompts-editing":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PENDING_PROMPTS_WITH_EDITING)}
          steeringSeq={null}
          sessionMaterialized
          queueMutationInFlight={false}
          onBeginEdit={noop}
          onDelete={noop}
          onSteer={noop}
          onReorder={noop}
        />
      );
    case "subagents-queued-wake":
    case "subagents-queued-wake-with-approval":
      return (
        <PendingPromptList
          entries={derivePendingPromptQueueRows(
            PLAYGROUND_SUBAGENT_WAKE_QUEUE,
            PLAYGROUND_SUBAGENT_WAKE_TRANSCRIPT.linkCompletionsByCompletionId,
          )}
          steeringSeq={null}
          sessionMaterialized
          queueMutationInFlight={false}
          onBeginEdit={noop}
          onDelete={noop}
          onSteer={noop}
          onReorder={noop}
        />
      );
    case "agent-operations-pending-aggregate":
      return (
        <PendingPromptList
          entries={derivePendingPromptQueueRows(
            PLAYGROUND_AGENT_OPERATIONS_PENDING_ENTRIES,
            PLAYGROUND_AGENT_OPERATIONS_PENDING_COMPLETIONS,
          )}
          steeringSeq={null}
          sessionMaterialized
          queueMutationInFlight={false}
          onBeginEdit={noop}
          onDelete={noop}
          onSteer={noop}
          onReorder={noop}
        />
      );
    default:
      return null;
  }
}

function pendingQueueRows(entries: PendingPromptQueueEntry[]) {
  return entries.map(derivePendingPromptQueueRow);
}
