import { Button } from "#product/primitives/Button";
import { ChevronRight } from "#product/primitives/icons/core";
import { DelegatedAgentIdenticon } from "#product/components/workspace/delegated-work/DelegatedAgentIdenticon";
import {
  agentsPaneClusterSummary,
  agentsPaneStack,
  type AgentsPaneCluster,
} from "#product/lib/domain/delegated-work/agents-pane-model";

/**
 * Level 1 — only sessions that are delegating appear. Each row is title + live
 * summary + its agents as a glyph stack (Agents Pane canvas page). Sessions
 * without delegated work never clutter the list, so there is nothing here to
 * filter by hand.
 */
export function AgentsPaneOverview({
  clusters,
  onOpenCluster,
}: {
  clusters: readonly AgentsPaneCluster[];
  onOpenCluster: (sessionId: string) => void;
}) {
  if (clusters.length === 0) {
    return (
      <p className="m-0 px-2 py-1 text-ui text-muted-foreground">
        No session is delegating right now.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-0.5" data-agents-pane-overview>
      {clusters.map((cluster) => (
        <Button
          key={cluster.sessionId}
          type="button"
          variant="unstyled"
          size="unstyled"
          className="group flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ui hover:bg-hover"
          data-agents-pane-cluster-row
          onClick={() => onOpenCluster(cluster.sessionId)}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ui font-medium">{cluster.title}</span>
            <span className="block truncate text-ui-sm text-sidebar-muted-foreground">
              {agentsPaneClusterSummary(cluster.agents)}
            </span>
          </span>
          <span className="flex shrink-0 items-center -space-x-1">
            {agentsPaneStack(cluster).map((agent) => (
              <span
                key={agent.sessionLinkId}
                className="icon-large flex items-center justify-center rounded-full bg-surface-elevated ring-1 ring-border"
              >
                <DelegatedAgentIdenticon
                  identity={agent.identity}
                  className={`icon-indicator ${agent.identity.textColorClassName}`}
                />
              </span>
            ))}
          </span>
          <ChevronRight className="icon-paired shrink-0 text-faint opacity-0 group-hover:opacity-100" />
        </Button>
      ))}
    </div>
  );
}
