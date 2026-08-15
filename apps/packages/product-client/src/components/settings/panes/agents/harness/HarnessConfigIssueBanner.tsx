import type { AgentSummary } from "@anyharness/sdk";
import { ProviderIcon } from "#product/primitives/icons/provider-icons";
import { Badge } from "#product/primitives/Badge";
import { IconTile } from "#product/primitives/IconTile";
import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";
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
    <NoticeBanner
      tone="warning"
      className="flex-col items-stretch gap-3 sm:flex-row sm:items-center"
      icon={(
        <IconTile tone="warning" size="md">
          <ProviderIcon kind={agent.kind} className="icon-control" />
        </IconTile>
      )}
      data-harness-runtime-state={agent.readiness}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-ui font-medium text-foreground">{agent.displayName}</p>
          <Badge tone={tone}>{status.label}</Badge>
        </div>
        <p className="text-ui-sm text-muted-foreground">
          {configurationDetailForAgent(agent)}
        </p>
      </div>
    </NoticeBanner>
  );
}
