import { useState } from "react";
import { AgentsPaneAgentDetail } from "#product/components/workspace/agents-pane/AgentsPaneAgentDetail";
import { AgentsPaneClusterSections } from "#product/components/workspace/agents-pane/AgentsPaneClusterSections";
import { AgentsPaneConfirm } from "#product/components/workspace/agents-pane/AgentsPaneConfirm";
import { AgentsPaneHeader } from "#product/components/workspace/agents-pane/AgentsPaneHeader";
import { AgentsPaneOverview } from "#product/components/workspace/agents-pane/AgentsPaneOverview";
import {
  AGENTS_PANE_CLOSE_CONFIRM_BODY,
  AGENTS_PANE_PROMOTE_CONFIRM_BODY,
  agentsPaneCloseNeedsConfirm,
  agentsPaneClusterSummary,
  agentsPaneOverviewSummary,
  type AgentsPaneAgent,
  type AgentsPaneCluster,
} from "#product/lib/domain/delegated-work/agents-pane-model";
import type { AgentsPaneView } from "#product/stores/agents/agents-pane-store";

export interface AgentsPaneProps {
  view: AgentsPaneView;
  clusters: readonly AgentsPaneCluster[];
  closeAttributionFor?: (agent: AgentsPaneAgent) => string | null;
  onOpenCluster: (sessionId: string) => void;
  onOpenAgent: (sessionId: string, sessionLinkId: string) => void;
  onBack: () => void;
  onOpenSession: (agent: AgentsPaneAgent) => void;
  onPromote: (agent: AgentsPaneAgent) => void;
  onClose: (agent: AgentsPaneAgent) => void;
  onSend: (agent: AgentsPaneAgent, text: string) => void;
  isPromoting?: boolean;
  isClosing?: boolean;
  isSending?: boolean;
}

type PendingConfirm =
  | { kind: "close"; agent: AgentsPaneAgent }
  | { kind: "promote"; agent: AgentsPaneAgent }
  | null;

/**
 * The agents pane (ADR §4). One global surface, overview → cluster → agent,
 * driven entirely by the view it is handed — it never follows tab focus on its
 * own, so only an explicit entry point moves it.
 *
 * Both write actions live here rather than in the rows, because close is
 * reachable from a cluster row AND from the agent detail, and there must be
 * exactly one confirm.
 */
export function AgentsPane({
  view,
  clusters,
  closeAttributionFor,
  onOpenCluster,
  onOpenAgent,
  onBack,
  onOpenSession,
  onPromote,
  onClose,
  onSend,
  isPromoting = false,
  isClosing = false,
  isSending = false,
}: AgentsPaneProps) {
  const [confirm, setConfirm] = useState<PendingConfirm>(null);

  const cluster = view.kind === "overview"
    ? null
    : clusters.find((entry) => entry.sessionId === view.sessionId) ?? null;
  const agent = view.kind === "agent"
    ? cluster?.agents.find((entry) => entry.sessionLinkId === view.sessionLinkId) ?? null
    : null;

  const requestClose = (target: AgentsPaneAgent) => {
    // Idle and finished agents close instantly — the confirm exists only
    // because active work would be ended.
    if (agentsPaneCloseNeedsConfirm(target)) {
      setConfirm({ kind: "close", agent: target });
      return;
    }
    onClose(target);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface" data-agents-pane>
      {agent ? (
        <AgentsPaneAgentDetail
          agent={agent}
          closeAttribution={closeAttributionFor?.(agent) ?? null}
          onBack={onBack}
          onOpenSession={onOpenSession}
          onRequestPromote={(target) => setConfirm({ kind: "promote", agent: target })}
          onRequestClose={requestClose}
          onSend={onSend}
          isSending={isSending}
        />
      ) : (
        <>
          <AgentsPaneHeader
            title={cluster ? cluster.title : "Agents"}
            summary={cluster
              ? agentsPaneClusterSummary(cluster.agents)
              : agentsPaneOverviewSummary(clusters)}
            onBack={cluster ? onBack : null}
          />
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {cluster ? (
              <AgentsPaneClusterSections
                agents={cluster.agents}
                onSelect={(target) => onOpenAgent(cluster.sessionId, target.sessionLinkId)}
                onRequestClose={requestClose}
              />
            ) : (
              <AgentsPaneOverview clusters={clusters} onOpenCluster={onOpenCluster} />
            )}
          </div>
        </>
      )}
      <AgentsPaneConfirm
        open={confirm?.kind === "close"}
        title={confirm ? `Close "${confirm.agent.identity.title}"?` : ""}
        body={AGENTS_PANE_CLOSE_CONFIRM_BODY}
        confirmLabel="Close agent"
        cancelLabel="Keep working"
        pending={isClosing}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === "close") {
            onClose(confirm.agent);
          }
          setConfirm(null);
        }}
      />
      <AgentsPaneConfirm
        open={confirm?.kind === "promote"}
        title={confirm ? `Promote "${confirm.agent.identity.title}"?` : ""}
        body={`${AGENTS_PANE_PROMOTE_CONFIRM_BODY}.`}
        confirmLabel="Promote"
        cancelLabel="Cancel"
        pending={isPromoting}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === "promote") {
            onPromote(confirm.agent);
          }
          setConfirm(null);
        }}
      />
    </div>
  );
}
