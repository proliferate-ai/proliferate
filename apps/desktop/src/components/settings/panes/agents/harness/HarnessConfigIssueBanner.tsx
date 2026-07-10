import type { AgentSummary } from "@anyharness/sdk";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import {
  configurationDetailForAgent,
} from "@/lib/domain/agents/configuration-issues-presentation";
import { getAgentStatusDisplay } from "@/lib/domain/agents/status-presentation";

interface HarnessConfigIssueBannerProps {
  agent: AgentSummary;
}

/**
 * Inline warning banner shown at the top of a harness settings page when the
 * agent has configuration issues (needs login, credentials, or install).
 */
export function HarnessConfigIssueBanner({ agent }: HarnessConfigIssueBannerProps) {
  const status = getAgentStatusDisplay(agent, {});

  return (
    <div className="flex items-start gap-3 rounded-md border-l-4 border-warning bg-warning/10 p-4">
      <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center text-warning">
        <ProviderIcon kind={agent.kind} className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-ui font-medium text-foreground">
          {status.label}
        </p>
        <p className="text-ui-sm text-muted-foreground">
          {configurationDetailForAgent(agent)}
        </p>
      </div>
    </div>
  );
}
