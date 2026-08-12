import type { PromptProvenance, TranscriptState } from "@anyharness/sdk";
import { AgentMessageReceipt } from "#product/components/workspace/chat/transcript/AgentMessageReceipt";
import {
  useTranscriptCanOpenSession,
  useTranscriptOpenSession,
} from "#product/components/workspace/chat/transcript/TranscriptContexts";
import {
  formatAgentMessageReceiptVerb,
  isAgentSessionProvenance,
  isSubagentWakeProvenance,
} from "#product/domain/chats/subagents/provenance";
import type { TranscriptOpenSessionRole } from "#product/domain/chats/transcript/transcript-open-target";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import {
  historicalSubagentProvenanceRemainsAuthoritative,
  isDurableSubagentRelationship,
  resolveCurrentSessionRelationship,
  useAgentsPaneNavigationActions,
} from "#product/hooks/agents/workflows/use-agents-pane-navigation-actions";

export function AgentOriginPromptReceipt({
  provenance,
  exactMessage,
  transcript,
  parentSessionId,
  workspaceId,
}: {
  provenance: PromptProvenance | null | undefined;
  exactMessage: string;
  transcript: TranscriptState;
  parentSessionId: string | null;
  workspaceId: string | null;
}) {
  const openSession = useTranscriptOpenSession();
  const canOpenSession = useTranscriptCanOpenSession();
  const wakeProvenance = isSubagentWakeProvenance(provenance) ? provenance : null;
  const agentSessionProvenance = isAgentSessionProvenance(provenance) ? provenance : null;
  const completion = wakeProvenance
    ? transcript.linkCompletionsByCompletionId[wakeProvenance.completionId] ?? null
    : null;
  // Wake identity is resolved only from the completion index. The hidden
  // prompt body and relationship ID are never identity fallbacks.
  const targetSessionId = agentSessionProvenance?.sourceSessionId
    ?? completion?.childSessionId
    ?? null;
  const directoryAgent = useSessionDirectoryStore((state) => {
    if (!targetSessionId) {
      return null;
    }
    const clientSessionId =
      state.clientSessionIdByMaterializedSessionId[targetSessionId] ?? targetSessionId;
    return state.entriesById[clientSessionId] ?? null;
  });
  const currentRelationship = useSessionDirectoryStore((state) =>
    targetSessionId
      ? resolveCurrentSessionRelationship(state, targetSessionId).relationship
      : null
  );
  const currentWorkspaceId = useSessionDirectoryStore((state) =>
    targetSessionId
      ? resolveCurrentSessionRelationship(state, targetSessionId).workspaceId
      : null
  );
  const currentClientSessionId = useSessionDirectoryStore((state) =>
    targetSessionId
      ? resolveCurrentSessionRelationship(state, targetSessionId).clientSessionId
      : null
  );
  const { openAgentsPaneTarget } = useAgentsPaneNavigationActions();
  const receiptProvenance = agentSessionProvenance ?? wakeProvenance;
  const targetRole: TranscriptOpenSessionRole = currentRelationship
    ? roleFromDirectoryRelationship(currentRelationship.kind)
    : agentSessionProvenance
      ? "agent-parent"
    : wakeProvenance?.type === "linkWake"
      && wakeProvenance.relation === "cowork_coding_session"
      ? "cowork-coding-child"
      : "linked-child";
  const fallbackLabel =
    provenance?.label?.trim()
    || completion?.label?.trim()
    || directoryAgent?.title?.trim()
    || directoryAgent?.activity.transcriptTitle?.trim()
    || (targetRole === "cowork-coding-child" ? "Coding session" : "Agent");
  const identity = targetSessionId
    ? buildDelegatedAgentIdentity({
      id: targetSessionId,
      title: fallbackLabel,
      workspaceId: currentWorkspaceId ?? workspaceId,
      sessionId: targetSessionId,
      sessionLinkId:
        wakeProvenance?.sessionLinkId
        ?? agentSessionProvenance?.sessionLinkId
        ?? null,
    })
    : null;
  const navigationSessionId = currentClientSessionId ?? targetSessionId;
  const relationship = currentRelationship;
  const historicalWakeIsSubagent = wakeProvenance?.type === "subagentWake"
    || (wakeProvenance?.type === "linkWake" && wakeProvenance.relation === "subagent");
  const hasDurableSubagentAuthority = isDurableSubagentRelationship(relationship)
    && currentWorkspaceId !== null;
  const historicalWakeHasMatchingPendingAuthority = historicalWakeIsSubagent
    && relationship?.kind === "pending"
    && historicalSubagentProvenanceRemainsAuthoritative(
      relationship,
      currentWorkspaceId !== null,
    )
    && currentWorkspaceId === workspaceId;
  const currentRelationshipKeepsOrdinaryNavigation = Boolean(
    relationship
    && relationship.kind !== "pending"
    && !isDurableSubagentRelationship(relationship),
  );
  const paneSourceIsSubagent = (
    historicalWakeIsSubagent
    && (hasDurableSubagentAuthority || historicalWakeHasMatchingPendingAuthority)
  )
    || (agentSessionProvenance !== null && hasDurableSubagentAuthority);
  const paneParentCandidate = isDurableSubagentRelationship(relationship)
    ? relationship.parentSessionId
    : completion?.parentSessionId ?? parentSessionId;
  const paneParentSessionId = useSessionDirectoryStore((state) =>
    paneParentCandidate
      ? state.entriesById[paneParentCandidate]?.materializedSessionId ?? paneParentCandidate
      : null
  );
  const navigationWorkspaceId = currentWorkspaceId ?? workspaceId;
  const currentSubagentOwnsNavigation = Boolean(
    paneSourceIsSubagent
    && navigationWorkspaceId
    && workspaceId
    && navigationWorkspaceId === workspaceId,
  );
  const canOpenInAgentsPane = Boolean(
    currentSubagentOwnsNavigation
    && targetSessionId
    && paneParentSessionId
    && navigationWorkspaceId
    && navigationWorkspaceId === workspaceId,
  );
  const canUseOrdinaryNavigation = Boolean(
    !currentSubagentOwnsNavigation
    && (
      !historicalWakeIsSubagent
      || currentRelationshipKeepsOrdinaryNavigation
      || hasDurableSubagentAuthority
    ),
  );
  const canOpen = Boolean(
    canOpenInAgentsPane
    || (canUseOrdinaryNavigation && (
      navigationSessionId
      && openSession
      && (canOpenSession?.(navigationSessionId, targetRole) ?? true)
    )),
  );
  const handleOpen = canOpen && targetSessionId
    ? () => {
      if (
        canOpenInAgentsPane
        && paneParentSessionId
        && navigationWorkspaceId
      ) {
        const target = {
          workspaceId: navigationWorkspaceId,
          parentSessionId: paneParentSessionId,
          childSessionId: targetSessionId,
          historicalSubagentProvenance: historicalWakeIsSubagent,
        };
        openAgentsPaneTarget(target);
        return;
      }
      if (!navigationSessionId) {
        return;
      }
      openSession?.(navigationSessionId, targetRole);
    }
    : undefined;

  if (!receiptProvenance) {
    return null;
  }

  return (
    <div className="flex justify-end" data-agent-origin-prompt>
      <AgentMessageReceipt
        direction="incoming"
        identity={identity}
        fallbackLabel={fallbackLabel}
        verb={formatAgentMessageReceiptVerb({
          provenance: receiptProvenance,
          completion,
        })}
        exactMessage={exactMessage}
        onOpen={handleOpen}
      />
    </div>
  );
}

function roleFromDirectoryRelationship(
  kind: "root" | "pending" | "subagent_child" | "cowork_child" | "review_child" | "linked_child",
): TranscriptOpenSessionRole {
  if (kind === "cowork_child") {
    return "cowork-coding-child";
  }
  if (kind === "subagent_child" || kind === "review_child" || kind === "linked_child") {
    return "linked-child";
  }
  return "generic";
}
