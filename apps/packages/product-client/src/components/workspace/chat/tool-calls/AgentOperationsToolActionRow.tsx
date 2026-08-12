import { useMemo, useState } from "react";
import { AutoHideScrollArea } from "#product/primitives/patterns/AutoHideScrollArea";
import { AgentMessageReceipt } from "#product/components/workspace/chat/transcript/AgentMessageReceipt";
import {
  AgentOperationsLifecycleReceipt,
  AgentOperationsWorkspaceReceipt,
} from "#product/components/workspace/chat/tool-calls/AgentOperationsReceiptRows";
import {
  useTranscriptCanOpenSession,
  useTranscriptOpenSession,
  useTranscriptSessionId,
} from "#product/components/workspace/chat/transcript/TranscriptContexts";
import { useWorkspaceSelection } from "#product/hooks/workspaces/workflows/selection/use-workspace-selection";
import { useWorkspaceActivationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-activation-workflow";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import type { ToolCallItem } from "@anyharness/sdk";
import type { AgentOperationsReceiptPresentation } from "#product/domain/chats/tools/agent-operations-tool-presentation";
import type { TranscriptOpenSessionRole } from "#product/domain/chats/transcript/transcript-open-target";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { ToolActionDetailsPanel } from "#product/components/workspace/chat/tool-calls/ToolActionDetailsPanel";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "#product/domain/chats/tools/tool-call-layout";
import {
  historicalSubagentProvenanceRemainsAuthoritative,
  isDurableSubagentRelationship,
  resolveCurrentSessionRelationship,
  useAgentsPaneNavigationActions,
} from "#product/hooks/agents/workflows/use-agents-pane-navigation-actions";
import { deriveAuthoritativeAgentOperation } from "#product/lib/domain/sessions/agent-operations-authority";
import { targetAgentFromDurableId } from "#product/domain/chats/tools/agent-operations-tool-output";

export function AgentOperationsToolActionRow({
  item,
  presentation,
  resultText,
  currentWorkspaceId,
}: {
  item: ToolCallItem;
  presentation: AgentOperationsReceiptPresentation;
  resultText?: string | null;
  currentWorkspaceId: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const openSession = useTranscriptOpenSession();
  const canOpenSession = useTranscriptCanOpenSession();
  const transcriptSessionId = useTranscriptSessionId();
  const { selectWorkspace } = useWorkspaceSelection();
  const { openWorkspaceSession } = useWorkspaceActivationWorkflow();
  const { openAgentsPaneTarget } = useAgentsPaneNavigationActions();
  const { data: workspaceCollections } = useWorkspaces({ enabled: false });
  const callerDurableSessionId = useSessionDirectoryStore((state) =>
    transcriptSessionId
      ? state.entriesById[transcriptSessionId]?.materializedSessionId ?? transcriptSessionId
      : null
  );
  const strictCompletedOperation = callerDurableSessionId
    && item.status === "completed"
    && presentation.source === "workspace"
    && (presentation.action === "create_agent" || presentation.action === "promote_subagent")
      ? deriveAuthoritativeAgentOperation(item, callerDurableSessionId, currentWorkspaceId)
      : null;
  const navigationAgent = presentation.source === "workspace"
    && presentation.action === "create_agent"
      ? item.status === "completed"
        ? presentation.agent
        : null
      : presentation.source === "workspace"
        && presentation.action === "promote_subagent"
        ? item.status === "completed"
          ? strictCompletedOperation?.agent ?? null
          : presentation.targetAgentId
            ? targetAgentFromDurableId(presentation.targetAgentId)
            : null
        : presentation.source === "workspace"
      && (presentation.isRunning || presentation.isFailed)
      && presentation.targetAgentId
      ? targetAgentFromDurableId(presentation.targetAgentId)
      : presentation.agent;
  const targetSessionId = navigationAgent?.sessionId ?? null;
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
  const currentRelationshipWorkspaceId = useSessionDirectoryStore((state) =>
    targetSessionId
      ? resolveCurrentSessionRelationship(state, targetSessionId).workspaceId
      : null
  );
  const currentClientSessionId = useSessionDirectoryStore((state) =>
    targetSessionId
      ? resolveCurrentSessionRelationship(state, targetSessionId).clientSessionId
      : null
  );
  const resolvedAgentTitle = presentation.agent?.title?.trim()
    || directoryAgent?.title
    || directoryAgent?.activity.transcriptTitle
    || "Agent";
  const identity = useMemo(() => {
    const agent = presentation.agent;
    if (!agent) {
      return null;
    }
    return buildDelegatedAgentIdentity({
      id: agent.sessionId ?? presentation.targetAgentId ?? agent.title ?? "agent",
      title: resolvedAgentTitle,
      workspaceId: agent.workspaceId ?? directoryAgent?.workspaceId ?? null,
      sessionId: agent.sessionId,
    });
  }, [directoryAgent?.workspaceId, presentation.agent, presentation.targetAgentId, resolvedAgentTitle]);
  const openRole: TranscriptOpenSessionRole = presentation.action === "promote_subagent"
    || navigationAgent?.role === "ordinary"
    || currentRelationship?.kind === "root"
      ? "generic"
      : "linked-child";
  const legacySendWorkspaceId = presentation.source === "legacy_subagents"
    && presentation.action === "send_message"
      ? currentWorkspaceId
      : null;
  const navigationWorkspaceId = currentRelationshipWorkspaceId
    ?? navigationAgent?.workspaceId
    ?? legacySendWorkspaceId;
  const navigationSessionId = currentClientSessionId ?? targetSessionId;
  const paneParentCandidate = isDurableSubagentRelationship(currentRelationship)
    ? currentRelationship.parentSessionId
    : navigationAgent?.parentSessionId;
  const paneParentSessionId = useSessionDirectoryStore((state) =>
    paneParentCandidate
      ? state.entriesById[paneParentCandidate]?.materializedSessionId ?? paneParentCandidate
      : null
  );
  const historicalSubagentProvenance = navigationAgent?.role === "subagent";
  const hasDurableSubagentAuthority = isDurableSubagentRelationship(currentRelationship);
  const historicalTargetWorkspaceId = navigationAgent?.workspaceId ?? currentWorkspaceId;
  const hasMatchingPendingSubagentAuthority = historicalSubagentProvenance
    && (
      presentation.action !== "create_agent"
      || strictCompletedOperation?.action === "create_agent"
    )
    && currentRelationship?.kind === "pending"
    && historicalSubagentProvenanceRemainsAuthoritative(
      currentRelationship,
      currentRelationshipWorkspaceId !== null,
    )
    && currentRelationshipWorkspaceId === historicalTargetWorkspaceId
    && currentRelationshipWorkspaceId === currentWorkspaceId;
  const currentRelationshipKeepsOrdinaryNavigation = Boolean(
    currentRelationship
    && currentRelationship.kind !== "pending"
    && !isDurableSubagentRelationship(currentRelationship),
  );
  const currentSubagentOwnsNavigation = (
    hasDurableSubagentAuthority
    || hasMatchingPendingSubagentAuthority
  )
    && navigationWorkspaceId !== null
    && navigationWorkspaceId === currentWorkspaceId;
  const canOpenInAgentsPane = Boolean(
    currentSubagentOwnsNavigation
    && targetSessionId
    && paneParentSessionId
    && navigationWorkspaceId
    && navigationWorkspaceId === currentWorkspaceId,
  );
  const isCurrentWorkspace = navigationWorkspaceId !== null
    && navigationWorkspaceId === currentWorkspaceId;
  const isProjectedWorkspace = navigationWorkspaceId !== null
    && Boolean(
      workspaceCollections?.allWorkspaces.some(
        (workspace) => workspace.id === navigationWorkspaceId,
      ),
    );
  const usesTranscriptNavigation = Boolean(
    openSession
    && (
      isCurrentWorkspace
      || (legacySendWorkspaceId && !navigationAgent?.workspaceId && !directoryAgent)
    )
    && (canOpenSession?.(navigationSessionId ?? "", openRole) ?? true),
  );
  const hasAuthoritativeNavigation = navigationWorkspaceId !== null
    && Boolean(
      isCurrentWorkspace
      || directoryAgent
      || legacySendWorkspaceId
      || (navigationAgent?.workspaceId && isProjectedWorkspace),
  );
  const canUseOrdinaryNavigation = Boolean(
    !currentSubagentOwnsNavigation
    && (
      presentation.action !== "create_agent"
      || strictCompletedOperation?.action === "create_agent"
      || currentRelationshipKeepsOrdinaryNavigation
      || hasDurableSubagentAuthority
    )
    && (
      !historicalSubagentProvenance
      || currentRelationshipKeepsOrdinaryNavigation
      || hasDurableSubagentAuthority
    ),
  );
  const canOpenAgent = Boolean(
    navigationSessionId
    && (
      canOpenInAgentsPane
      || (
        canUseOrdinaryNavigation
        && hasAuthoritativeNavigation
        && (usesTranscriptNavigation || navigationWorkspaceId)
      )
    ),
  );
  const openAgent = canOpenAgent && navigationSessionId
    ? () => {
      if (
        canOpenInAgentsPane
        && targetSessionId
        && paneParentSessionId
        && navigationWorkspaceId
      ) {
        openAgentsPaneTarget({
          workspaceId: navigationWorkspaceId,
          parentSessionId: paneParentSessionId,
          childSessionId: targetSessionId,
          historicalSubagentProvenance,
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
    : undefined;
  const toggleDetails = resultText ? () => setExpanded((value) => !value) : undefined;

  const receipt = presentation.action === "send_message" ? (
    <AgentMessageReceipt
      direction="outgoing"
      identity={identity}
      fallbackLabel={resolvedAgentTitle}
      verb={presentation.isRunning ? "messaging" : presentation.isFailed ? "message failed" : "messaged"}
      exactMessage={presentation.message}
      onOpen={openAgent}
      onToggleDetails={toggleDetails}
      detailsExpanded={expanded}
    />
  ) : presentation.action === "create_workspace" ? (
    <AgentOperationsWorkspaceReceipt
      presentation={presentation}
      onOpen={presentation.workspace?.workspaceId
        ? () => {
          const workspace = presentation.workspace!;
          void selectWorkspace(workspace.workspaceId!, {
            force: true,
            knownWorkspace: workspace.knownWorkspace,
          });
        }
        : undefined}
      onToggleDetails={toggleDetails}
      detailsExpanded={expanded}
    />
  ) : (
    <AgentOperationsLifecycleReceipt
      presentation={presentation}
      identity={identity}
      resolvedAgentTitle={resolvedAgentTitle}
      onOpen={openAgent}
      onToggleDetails={toggleDetails}
      detailsExpanded={expanded}
    />
  );

  return (
    <div>
      {receipt}
      {expanded && resultText ? (
        <div className="mt-1.5">
          <ToolActionDetailsPanel>
            <AutoHideScrollArea
              className="w-full"
              viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
            >
              <pre className="m-0 whitespace-pre-wrap px-3 py-2 font-mono text-readable-code text-muted-foreground">
                {resultText}
              </pre>
            </AutoHideScrollArea>
          </ToolActionDetailsPanel>
        </div>
      ) : null}
    </div>
  );
}
