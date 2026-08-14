import { AgentIdentityChip } from "#product/components/patterns/AgentIdentityChip";
import {
  useTranscriptCanOpenSession,
  useTranscriptOpenSession,
} from "#product/components/workspace/chat/transcript/TranscriptContexts";
import type { TranscriptOpenSessionRole } from "#product/domain/chats/transcript/transcript-open-target";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import { useWorkspaceActivationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-activation-workflow";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import {
  subagentCreationReceiptEntryId,
  useTranscriptEntryMotion,
} from "#product/components/workspace/chat/transcript/TranscriptEntryMotionContext";
import {
  historicalSubagentProvenanceRemainsAuthoritative,
  isDurableSubagentRelationship,
  resolveCurrentSessionRelationship,
  useAgentsPaneNavigationActions,
} from "#product/hooks/agents/workflows/use-agents-pane-navigation-actions";
import type { SpawnReceipt } from "./SubagentCreationGroupBlock";

// Split from SubagentCreationGroupBlock.tsx along the per-receipt navigation
// subcomponent seam to keep that file under the documented frontend file
// threshold.
export function SpawnIdentityReceipt({
  receipt,
  sessionId,
  selectedWorkspaceId,
  projectedWorkspaceIds,
  openSession,
  canOpenSession,
  openWorkspaceSession,
  parentDurableSessionId,
  parentWorkspaceId,
  animateEntry,
}: {
  receipt: SpawnReceipt;
  sessionId: string;
  selectedWorkspaceId: string | null;
  projectedWorkspaceIds: ReadonlySet<string>;
  openSession: ReturnType<typeof useTranscriptOpenSession>;
  canOpenSession: ReturnType<typeof useTranscriptCanOpenSession>;
  openWorkspaceSession: ReturnType<
    typeof useWorkspaceActivationWorkflow
  >["openWorkspaceSession"];
  parentDurableSessionId: string | null;
  parentWorkspaceId: string | null;
  animateEntry: boolean;
}) {
  const { openAgentsPaneTarget } = useAgentsPaneNavigationActions();
  const shouldAnimateEntry = useTranscriptEntryMotion(
    subagentCreationReceiptEntryId(receipt.key),
    animateEntry,
  );
  const navigationSessionId = useSessionDirectoryStore((state) =>
    state.clientSessionIdByMaterializedSessionId[sessionId] ?? sessionId
  );
  const directoryWorkspaceId = useSessionDirectoryStore((state) =>
    state.entriesById[navigationSessionId]?.workspaceId
      ?? resolveCurrentSessionRelationship(state, sessionId).workspaceId
  );
  const hasDirectoryEntry = useSessionDirectoryStore(
    (state) => Boolean(state.entriesById[navigationSessionId]),
  );
  const directoryRelationship = useSessionDirectoryStore((state) =>
    resolveCurrentSessionRelationship(state, sessionId).relationship
  );
  const identity = buildDelegatedAgentIdentity({
    id: sessionId,
    title: receipt.title,
    sessionId,
  });
  const historicalTargetWorkspaceId = receipt.workspaceId ?? parentWorkspaceId;
  const navigationWorkspaceId = directoryWorkspaceId ?? historicalTargetWorkspaceId;
  const hasDurableSubagentAuthority = isDurableSubagentRelationship(directoryRelationship);
  const hasMatchingPendingSubagentAuthority = directoryRelationship?.kind === "pending"
    && receipt.historicalNavigationAuthorized
    && historicalSubagentProvenanceRemainsAuthoritative(
      directoryRelationship,
      directoryWorkspaceId !== null,
    )
    && directoryWorkspaceId === historicalTargetWorkspaceId
    && directoryWorkspaceId === selectedWorkspaceId;
  const currentRelationshipKeepsOrdinaryNavigation = Boolean(
    directoryRelationship
    && directoryRelationship.kind !== "pending"
    && !isDurableSubagentRelationship(directoryRelationship),
  );
  const openRole: TranscriptOpenSessionRole = directoryRelationship?.kind === "root"
    ? "generic"
    : directoryRelationship?.kind === "cowork_child"
      ? "cowork-coding-child"
      : "linked-child";
  const isCurrentWorkspace = navigationWorkspaceId !== null
    && navigationWorkspaceId === selectedWorkspaceId;
  const currentSubagentOwnsNavigation = isCurrentWorkspace
    && (hasDurableSubagentAuthority || hasMatchingPendingSubagentAuthority);
  const paneParentCandidate = isDurableSubagentRelationship(directoryRelationship)
    ? directoryRelationship.parentSessionId
    : parentDurableSessionId;
  const paneParentSessionId = useSessionDirectoryStore((state) =>
    paneParentCandidate
      ? state.entriesById[paneParentCandidate]?.materializedSessionId ?? paneParentCandidate
      : null
  );
  const canOpenInAgentsPane = Boolean(
    currentSubagentOwnsNavigation
    && navigationWorkspaceId
    && paneParentSessionId,
  );
  const usesTranscriptNavigation = Boolean(
    openSession
    && (isCurrentWorkspace || !navigationWorkspaceId)
    && (canOpenSession?.(navigationSessionId, openRole) ?? true),
  );
  const canUseOrdinaryNavigation = Boolean(
    !currentSubagentOwnsNavigation
    && (hasDurableSubagentAuthority || currentRelationshipKeepsOrdinaryNavigation),
  );
  const canOpen = Boolean(
    canOpenInAgentsPane
    || (canUseOrdinaryNavigation && usesTranscriptNavigation)
    || (canUseOrdinaryNavigation && (
      navigationWorkspaceId
      && (hasDirectoryEntry || projectedWorkspaceIds.has(navigationWorkspaceId))
    )),
  );

  return (
    <span
      data-subagent-spawn-entry={receipt.key}
      data-subagent-spawn-entry-motion={shouldAnimateEntry ? "true" : undefined}
      className={`inline-flex ${shouldAnimateEntry ? "subagent-spawn-chip-enter" : ""}`.trim()}
    >
      <AgentIdentityChip
        identity={identity}
        onOpen={canOpen
          ? () => {
            if (
              canOpenInAgentsPane
              && navigationWorkspaceId
              && paneParentSessionId
            ) {
              openAgentsPaneTarget({
                workspaceId: navigationWorkspaceId,
                parentSessionId: paneParentSessionId,
                childSessionId: sessionId,
                historicalSubagentProvenance: true,
              });
              return;
            }
            if (usesTranscriptNavigation) {
              openSession?.(navigationSessionId, openRole);
              return;
            }
            if (navigationWorkspaceId) {
              void openWorkspaceSession({
                workspaceId: navigationWorkspaceId,
                sessionId: navigationSessionId,
              });
            }
          }
          : undefined}
      />
    </span>
  );
}
