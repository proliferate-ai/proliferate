import type { AgentSummary } from "@anyharness/sdk";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  configurationDetailForAgent,
} from "@/lib/domain/agents/configuration-issues-presentation";
import { getAgentStatusDisplay } from "@/lib/domain/agents/status-presentation";
import type { HarnessInstallAction } from "@/hooks/agents/workflows/use-harness-install-action";

interface HarnessConfigIssueBannerProps {
  agent: AgentSummary;
  installAction?: HarnessInstallAction | null;
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
  const progress = installAction?.kind === "progress" ? installAction : null;
  const action = installAction?.kind === "action" ? installAction : null;

  return (
    <div
      className="flex items-start gap-3 rounded-md border-l-4 border-warning bg-warning/10 p-4"
      aria-live={progress ? "polite" : undefined}
    >
      <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center text-warning">
        <ProviderIcon kind={agent.kind} className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-ui font-medium text-foreground">
          {progress?.label ?? status.label}
        </p>
        <p className="text-ui-sm text-muted-foreground">
          {progress?.detail ?? configurationDetailForAgent(agent)}
        </p>
      </div>
      {action ? (
        <Button
          variant="outline"
          size="sm"
          loading={action.loading}
          disabled={action.disabled}
          onClick={action.onInstall}
          className="shrink-0"
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
