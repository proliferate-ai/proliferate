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
  isDurableSubagentRelationship,
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
  const { openAgentsPaneTarget } = useAgentsPaneNavigationActions();
  const receiptProvenance = agentSessionProvenance ?? wakeProvenance;
  const targetRole: TranscriptOpenSessionRole = agentSessionProvenance
    ? directoryAgent
      ? roleFromDirectoryRelationship(directoryAgent.sessionRelationship.kind)
      : "agent-parent"
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
      workspaceId: directoryAgent?.workspaceId ?? workspaceId,
      sessionId: targetSessionId,
      sessionLinkId:
        wakeProvenance?.sessionLinkId
        ?? agentSessionProvenance?.sessionLinkId
        ?? null,
    })
    : null;
  const navigationSessionId = directoryAgent?.sessionId ?? targetSessionId;
  const relationship = directoryAgent?.sessionRelationship;
  const paneSourceIsSubagent = wakeProvenance?.type === "subagentWake"
    || (wakeProvenance?.type === "linkWake" && wakeProvenance.relation === "subagent")
    || (agentSessionProvenance !== null && isDurableSubagentRelationship(relationship));
  const paneParentCandidate = completion?.parentSessionId
    ?? (isDurableSubagentRelationship(relationship) ? relationship.parentSessionId : null)
    ?? parentSessionId;
  const paneParentSessionId = useSessionDirectoryStore((state) =>
    paneParentCandidate
      ? state.entriesById[paneParentCandidate]?.materializedSessionId ?? paneParentCandidate
      : null
  );
  const navigationWorkspaceId = directoryAgent?.workspaceId ?? workspaceId;
  const canOpenInAgentsPane = Boolean(
    paneSourceIsSubagent
    && targetSessionId
    && paneParentSessionId
    && navigationWorkspaceId
    && navigationWorkspaceId === workspaceId,
  );
  const canOpen = Boolean(
    canOpenInAgentsPane
    || (
      navigationSessionId
      && openSession
      && (canOpenSession?.(navigationSessionId, targetRole) ?? true)
    ),
  );
  const handleOpen = canOpen && targetSessionId
    ? () => {
      if (
        canOpenInAgentsPane
        && paneParentSessionId
        && navigationWorkspaceId
        && openAgentsPaneTarget({
          workspaceId: navigationWorkspaceId,
          parentSessionId: paneParentSessionId,
          childSessionId: targetSessionId,
        })
      ) {
        return;
      }
      if (!navigationSessionId) {
        return;
      }
      if (wakeProvenance) {
        useSessionDirectoryStore.getState().recordRelationshipHint(navigationSessionId, {
          kind: wakeProvenance.type === "subagentWake"
            ? "subagent_child"
            : targetRole === "cowork-coding-child"
              ? "cowork_child"
              : "linked_child",
          parentSessionId,
          sessionLinkId: wakeProvenance.sessionLinkId,
          relation: wakeProvenance.type === "linkWake"
            ? wakeProvenance.relation
            : "subagent",
          workspaceId: directoryAgent?.workspaceId ?? workspaceId,
        });
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
