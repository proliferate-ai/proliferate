import type { ReactNode } from "react";
import { PendingPromptList } from "@/components/workspace/chat/input/PendingPromptList";
import type { ScenarioKey } from "@/config/playground";
import {
  PENDING_PROMPTS_MULTI,
  PENDING_PROMPTS_SINGLE,
  PENDING_PROMPTS_WITH_EDITING,
} from "@/lib/domain/chat/__fixtures__/playground/outbound-slot-fixtures";
import {
  PLAYGROUND_SUBAGENT_WAKE_QUEUE,
} from "@/lib/domain/chat/__fixtures__/playground/subagent-wake-transcript-fixtures";
import {
  derivePendingPromptQueueRow,
  type PendingPromptQueueEntry,
} from "@proliferate/product-domain/chats/pending-prompts/pending-prompt-queue";
import { noop } from "@/components/playground/PlaygroundComposerActions";

export function renderOutboundSlot(scenario: ScenarioKey): ReactNode | null {
  switch (scenario) {
    case "pending-prompts-single":
    case "pending-prompts-with-approval":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PENDING_PROMPTS_SINGLE)}
          steeringSeq={null}
          sessionMaterialized={true}
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
          sessionMaterialized={true}
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
          sessionMaterialized={true}
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
          entries={pendingQueueRows(PLAYGROUND_SUBAGENT_WAKE_QUEUE)}
          steeringSeq={null}
          sessionMaterialized={true}
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
