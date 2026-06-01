import {
  selectPendingApprovalInteraction,
  selectPendingMcpElicitationInteraction,
  selectPendingUserInputInteraction,
  selectPrimaryPendingInteraction,
  type PendingInteraction,
  type PendingPromptEntry,
} from "@anyharness/sdk";
import {
  outboxEntryToPendingPromptEntry,
  projectPendingPromptsWithSessionIntents,
  queuedOutboxEntriesForSession,
} from "@proliferate/product-domain/sessions/intents/session-intent-selectors";
import type {
  PromptOutboxEntry,
  SessionIntent,
} from "@proliferate/product-domain/sessions/intents/session-intent-model";
import { sessionIntentsForSession } from "@proliferate/product-domain/sessions/intents/session-intent-state";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { parsePermissionOptionActions, type PermissionOptionAction } from "@/lib/domain/chat/composer/chat-input-helpers";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { useActiveSessionId } from "./use-active-session-identity";

const EMPTY_PENDING_PROMPTS: readonly PendingPromptEntry[] = [];
const EMPTY_PENDING_INTERACTIONS: readonly PendingInteraction[] = [];
const EMPTY_SESSION_INTENTS: readonly SessionIntent[] = [];

export function useActivePendingPrompts(): readonly PendingPromptEntry[] {
  const activeSessionId = useActiveSessionId();
  const runtimePendingPrompts = useSessionTranscriptStore((state) =>
    activeSessionId
      ? state.entriesById[activeSessionId]?.transcript?.pendingPrompts ?? EMPTY_PENDING_PROMPTS
      : EMPTY_PENDING_PROMPTS
  );
  const sessionIntents = useSessionIntentStore(useShallow((state) =>
    activeSessionId ? sessionIntentsForSession(state, activeSessionId) : EMPTY_SESSION_INTENTS
  ));
  const outboxEntries = useMemo(
    () => sessionIntents.filter((intent): intent is PromptOutboxEntry => intent.kind === "send_prompt"),
    [sessionIntents],
  );
  const outboxQueuedPrompts = useMemo(() => {
    const entries = outboxEntries;
    return entries.length > 0
      ? queuedOutboxEntriesForSession(entries).map(outboxEntryToPendingPromptEntry)
      : EMPTY_PENDING_PROMPTS;
  }, [outboxEntries]);
  return useMemo(() => {
    const projectedRuntimePendingPrompts = projectPendingPromptsWithSessionIntents(
      runtimePendingPrompts,
      sessionIntents,
    );
    if (projectedRuntimePendingPrompts.length === 0) {
      return outboxQueuedPrompts;
    }
    if (outboxQueuedPrompts.length === 0) {
      return projectedRuntimePendingPrompts;
    }
    const runtimePromptIds = new Set(
      projectedRuntimePendingPrompts.map((entry) => entry.promptId).filter(Boolean),
    );
    return [
      ...projectedRuntimePendingPrompts,
      ...outboxQueuedPrompts.filter((entry) =>
        !entry.promptId || !runtimePromptIds.has(entry.promptId)
      ),
    ];
  }, [outboxQueuedPrompts, runtimePendingPrompts, sessionIntents]);
}

export function useActivePendingInteractionState(): {
  pendingInteractions: readonly PendingInteraction[];
  pendingApproval: ReturnType<typeof selectPendingApprovalInteraction>;
  pendingUserInput: ReturnType<typeof selectPendingUserInputInteraction>;
  pendingMcpElicitation: ReturnType<typeof selectPendingMcpElicitationInteraction>;
  primaryPendingInteraction: ReturnType<typeof selectPrimaryPendingInteraction>;
} {
  const activeSessionId = useActiveSessionId();
  return useSessionTranscriptStore(useShallow((state) => {
    const transcript = activeSessionId
      ? state.entriesById[activeSessionId]?.transcript ?? null
      : null;
    return {
      pendingInteractions: transcript?.pendingInteractions ?? EMPTY_PENDING_INTERACTIONS,
      pendingApproval: transcript ? selectPendingApprovalInteraction(transcript) : null,
      pendingUserInput: transcript ? selectPendingUserInputInteraction(transcript) : null,
      pendingMcpElicitation: transcript ? selectPendingMcpElicitationInteraction(transcript) : null,
      primaryPendingInteraction: transcript ? selectPrimaryPendingInteraction(transcript) : null,
    };
  }));
}

export function useActivePendingApproval(): {
  pendingApproval: ReturnType<typeof selectPendingApprovalInteraction>;
  pendingApprovalActions: PermissionOptionAction[];
} {
  const pendingApproval = useActivePendingInteractionState().pendingApproval;
  const pendingApprovalActions = useMemo<PermissionOptionAction[]>(
    () => parsePermissionOptionActions(pendingApproval?.options),
    [pendingApproval?.options],
  );
  return { pendingApproval, pendingApprovalActions };
}
