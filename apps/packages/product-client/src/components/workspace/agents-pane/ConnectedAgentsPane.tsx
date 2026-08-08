import { useCallback, useMemo } from "react";
import { useCloseSessionMutation, usePromptSessionTextMutation } from "@anyharness/sdk-react";
import { AgentsPane } from "#product/components/workspace/agents-pane/AgentsPane";
import { useDelegatedWorkComposer } from "#product/hooks/chat/facade/use-delegated-work-composer";
import { useActiveSessionId } from "#product/hooks/chat/derived/use-active-session-identity";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import { useAgentsPaneStore } from "#product/stores/agents/agents-pane-store";
import {
  toAgentsPaneAgent,
  type AgentsPaneAgent,
  type AgentsPaneCluster,
} from "#product/lib/domain/delegated-work/agents-pane-model";

/**
 * The agents pane, wired.
 *
 * Level 1 is built from the delegated work the client has actually read. The
 * session-subagents endpoint is per session, so the overview lists the sessions
 * whose fanout has been read — today that is the session in view. Nothing here
 * invents a global read model, and native harness work and terminals are never
 * candidates: they do not come through this endpoint at all.
 */
export function ConnectedAgentsPane() {
  const delegated = useDelegatedWorkComposer();
  const activeSessionId = useActiveSessionId();
  const view = useAgentsPaneStore((state) => state.view);
  const openCluster = useAgentsPaneStore((state) => state.openCluster);
  const openAgent = useAgentsPaneStore((state) => state.openAgent);
  const back = useAgentsPaneStore((state) => state.back);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const showErrorToast = useToastStore((state) => state.showError);
  const sessionTitle = useSessionDirectoryStore((state) => (
    activeSessionId ? state.entriesById[activeSessionId]?.title ?? null : null
  ));
  const workspaceId = useSessionDirectoryStore((state) => (
    activeSessionId ? state.entriesById[activeSessionId]?.workspaceId ?? null : null
  )) ?? selectedWorkspaceId;

  const closeSessionMutation = useCloseSessionMutation({ workspaceId });
  const promptSessionMutation = usePromptSessionTextMutation({ workspaceId });

  const subagents = delegated?.subagents ?? null;
  // The cluster is the DELEGATING session — for a child in view that is its
  // parent, which is exactly the fanout the strip already reads.
  const clusterSessionId = subagents?.parent?.parentSessionId ?? activeSessionId ?? null;

  const clusters = useMemo<AgentsPaneCluster[]>(() => {
    if (!subagents || !clusterSessionId) {
      return [];
    }
    const agents = [...subagents.rows, ...subagents.ownedAgents].map(toAgentsPaneAgent);
    if (agents.length === 0) {
      return [];
    }
    return [{
      sessionId: clusterSessionId,
      title: subagents.parent?.label ?? sessionTitle ?? "This session",
      agents,
    }];
  }, [clusterSessionId, sessionTitle, subagents]);

  const openSession = useCallback((agent: AgentsPaneAgent) => {
    if (!subagents) return;
    if (agent.ownership === "subagent") {
      subagents.openSubagent(agent.childSessionId);
      return;
    }
    subagents.openOwnedAgent(agent.childSessionId);
  }, [subagents]);

  const promote = useCallback((agent: AgentsPaneAgent) => {
    subagents?.promote(agent.childSessionId);
  }, [subagents]);

  const closeAgent = useCallback((agent: AgentsPaneAgent) => {
    void closeSessionMutation.mutateAsync({
      sessionId: agent.childSessionId,
      workspaceId: agent.workspaceId ?? workspaceId,
    }).catch((error: unknown) => {
      showErrorToast({
        headline: "Agent not closed",
        consequence: "It is still running.",
        cause: error instanceof Error ? error.message : String(error),
      });
    });
  }, [closeSessionMutation, showErrorToast, workspaceId]);

  const send = useCallback((agent: AgentsPaneAgent, text: string) => {
    if (!text) return;
    void promptSessionMutation.mutateAsync({
      sessionId: agent.childSessionId,
      text,
    }).catch((error: unknown) => {
      showErrorToast({
        headline: "Message not delivered",
        consequence: "The agent never received it.",
        cause: error instanceof Error ? error.message : String(error),
      });
    });
  }, [promptSessionMutation, showErrorToast]);

  return (
    <AgentsPane
      view={view}
      clusters={clusters}
      onOpenCluster={openCluster}
      onOpenAgent={openAgent}
      onBack={back}
      onOpenSession={openSession}
      onPromote={promote}
      onClose={closeAgent}
      onSend={send}
      isPromoting={subagents?.isPromoting ?? false}
      isClosing={closeSessionMutation.isPending}
      isSending={promptSessionMutation.isPending}
    />
  );
}
