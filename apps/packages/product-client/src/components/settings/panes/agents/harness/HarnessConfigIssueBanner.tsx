import type { AgentSummary } from "@anyharness/sdk";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { Badge } from "@proliferate/ui/primitives/Badge";
import {
  configurationDetailForAgent,
} from "#product/lib/domain/agents/configuration-issues-presentation";
import { getAgentStatusDisplay } from "#product/lib/domain/agents/status-presentation";

/**
 * Inline warning shown after installation when a harness still needs login,
 * credentials, or another non-install repair.
 */
export function HarnessConfigIssueBanner({
  agent,
}: {
  agent: AgentSummary;
}) {
  const status = getAgentStatusDisplay(agent, {});
  const tone = status.tone === "destructive" ? "destructive" : "warning";

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3.5 sm:flex-row sm:items-center"
      data-harness-runtime-state={agent.readiness}
    >
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-warning/10 text-warning">
        <ProviderIcon kind={agent.kind} className="icon-control" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-ui font-medium text-foreground">{agent.displayName}</p>
          <Badge tone={tone}>{status.label}</Badge>
        </div>
        <p className="text-ui-sm text-muted-foreground">
          {configurationDetailForAgent(agent)}
        </p>
      </div>
    </div>
  );
}
