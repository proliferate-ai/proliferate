import type { AgentSummary } from "@anyharness/sdk";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  configurationDetailForAgent,
} from "#product/lib/domain/agents/configuration-issues-presentation";
import { getAgentStatusDisplay } from "#product/lib/domain/agents/status-presentation";

interface HarnessConfigIssueBannerProps {
  agent: AgentSummary;
  installAction?: {
    label: string;
    loading: boolean;
    disabled: boolean;
    onInstall: () => void;
  } | null;
}

/**
 * Inline warning banner shown at the top of a harness settings page when the
 * agent has configuration issues (needs login, credentials, or install).
 */
export function HarnessConfigIssueBanner({
  agent,
  installAction = null,
}: HarnessConfigIssueBannerProps) {
  const status = getAgentStatusDisplay(agent, {});
  const tone = status.tone === "destructive" ? "destructive" : "warning";

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3.5 sm:flex-row sm:items-center"
      data-harness-runtime-state={agent.readiness}
    >
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-warning/10 text-warning">
        <ProviderIcon kind={agent.kind} className="size-4" />
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
      {installAction ? (
        <Button
          variant="primary"
          size="sm"
          loading={installAction.loading}
          disabled={installAction.disabled}
          onClick={installAction.onInstall}
          className="shrink-0 self-start sm:self-auto"
        >
          {installAction.label}
        </Button>
      ) : null}
    </div>
  );
}
