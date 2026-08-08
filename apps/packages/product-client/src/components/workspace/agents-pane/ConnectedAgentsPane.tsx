import { useCallback, useMemo } from "react";
import { useCloseSessionMutation, usePromptSessionTextMutation } from "@anyharness/sdk-react";
import { AgentsPane } from "#product/components/workspace/agents-pane/AgentsPane";
import { useDelegatedWorkComposer } from "#product/hooks/chat/facade/use-delegated-work-composer";
import { useActiveSessionId } from "#product/hooks/chat/derived/use-active-session-identity";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import { useAgentsPaneStore } from "#product/stores/agents/agents-pane-store";
import { shortSessionId } from "#product/domain/chats/subagents/provenance";
import {
  agentsPaneCloseAttributionForAgent,
  buildAgentsPaneClusters,
  type AgentsPaneAgent,
  type AgentsPaneCluster,
} from "#product/lib/domain/delegated-work/agents-pane-model";

/**
 * The agents pane, wired.
 *
 * Level 1 is built from the delegated work the client has actually read. The
 * session-subagents endpoint is per session, so the overview lists the sessions
 * whose fanout has been read — the session in view, and its parent when a child
 * is in view. Nothing here invents a global read model, and native harness work
 * and terminals are never candidates: they do not come through this endpoint at
 * all.
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

  // One cluster per DELEGATING session, each built only from that session's own
  // read model. The session in view contributes the fanout it parents plus the
  // peers it owns; a parent in the strip contributes its own fanout under its
  // own title. Merging the two would put a child's peers — which the parent
  // does not own — inside the parent's cluster.
  const clusters = useMemo<AgentsPaneCluster[]>(() => {
    if (!subagents) {
      return [];
    }
    const parent = subagents.parent;
    return buildAgentsPaneClusters({
      activeSessionId,
      activeSessionTitle: sessionTitle,
      ownRows: subagents.ownRows,
      ownedAgents: subagents.ownedAgents,
      parent: parent
        ? { sessionId: parent.parentSessionId, title: parent.label }
        : null,
      // `rows` is the sibling strip: the PARENT's fanout, read so a child can
      // see its siblings. It belongs under the parent's title and nowhere else.
      siblingRows: subagents.rows,
    });
  }, [activeSessionId, sessionTitle, subagents]);

  // "Closed by X · reason". The endpoint returns OPEN links, so this is
  // readable exactly in the close-requested window. The closer is a session id;
  // it resolves to a title only from sessions already in the directory, and
  // falls back to the short id rather than inventing a name.
  const sessionsById = useSessionDirectoryStore((state) => state.entriesById);
  const closeAttributionFor = useCallback((agent: AgentsPaneAgent) => (
    agentsPaneCloseAttributionForAgent(
      agent,
      (sessionId) => sessionsById[sessionId]?.title?.trim() || shortSessionId(sessionId),
    )
  ), [sessionsById]);

  const openSession = useCallback((agent: AgentsPaneAgent) => {
    if (!subagents) return;
    if (agent.ownership === "subagent") {
      subagents.openSubagent(agent.childSessionId);
      return;
    }
    subagents.openOwnedAgent(agent.childSessionId);
  }, [subagents]);

  // ADR §4's fourth detail action. The session config surface
  // (`SessionConfigControls` over the `config-options` route) is built for the
  // session in view and has no out-of-tab form, so "Configure agent…" opens the
  // agent's tab — where its model / mode / effort controls already live —
  // rather than growing a second config UI here.
  const configure = useCallback((agent: AgentsPaneAgent) => {
    openSession(agent);
  }, [openSession]);

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
      closeAttributionFor={closeAttributionFor}
      onOpenCluster={openCluster}
      onOpenAgent={openAgent}
      onBack={back}
      onOpenSession={openSession}
      onConfigure={configure}
      onPromote={promote}
      onClose={closeAgent}
      onSend={send}
      isPromoting={subagents?.isPromoting ?? false}
      isClosing={closeSessionMutation.isPending}
      isSending={promptSessionMutation.isPending}
    />
  );
}
