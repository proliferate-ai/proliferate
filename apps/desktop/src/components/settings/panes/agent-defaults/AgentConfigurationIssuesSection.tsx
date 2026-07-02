import type { AgentSummary, ReconcileAgentResult } from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { AgentLoginTerminalPanel } from "@/components/agents/AgentLoginTerminalPanel";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { AgentDefaultsSection } from "@/components/settings/panes/agent-defaults/AgentDefaultsSection";
import type { AgentLoginTerminalSession } from "@/hooks/agents/workflows/use-agent-login-terminal-workflow";
import {
  badgeToneForAgentStatus,
  configurationDetailForAgent,
} from "@/lib/domain/agents/configuration-issues-presentation";
import { getAgentStatusDisplay } from "@/lib/domain/agents/status-presentation";

export interface AgentConfigurationIssueAction {
  label: string;
  loading: boolean;
  onClick: () => void;
}

export function AgentConfigurationIssuesSection({
  agents,
  agentsLoading,
  isReconciling,
  reconcileResultsByKind,
  issueActionsByAgentKind,
  authTerminalSessionsByKind,
  authTerminalConnection,
  onCloseAuthTerminal,
  onAuthTerminalExit,
  onRestartAuthTerminal,
}: {
  agents: AgentSummary[];
  agentsLoading: boolean;
  isReconciling: boolean;
  reconcileResultsByKind: Map<string, ReconcileAgentResult>;
  issueActionsByAgentKind: Record<string, AgentConfigurationIssueAction>;
  authTerminalSessionsByKind: Record<string, AgentLoginTerminalSession>;
  authTerminalConnection: {
    baseUrl: string;
    authToken?: string;
  };
  onCloseAuthTerminal: (kind: string) => void;
  onAuthTerminalExit: (kind: string, code: number | null) => void;
  onRestartAuthTerminal: (agent: AgentSummary) => void;
}) {
  return (
    <AgentDefaultsSection
      title="Needs configuration"
      description="These harnesses are installed or known, but cannot be used as launch defaults yet."
    >
      <div>
        {agentsLoading ? (
          <div className="p-3">
            <LoadingState
              message="Checking agent configuration"
              subtext="Refreshing harness readiness..."
            />
          </div>
        ) : agents.map((agent) => {
          const reconcileResult = reconcileResultsByKind.get(agent.kind);
          const status = getAgentStatusDisplay(agent, {
            reconcileResult,
            isReconciling,
          });
          const authTerminalSession = authTerminalSessionsByKind[agent.kind] ?? null;
          const issueAction = issueActionsByAgentKind[agent.kind];

          return (
            <div
              key={agent.kind}
              className="border-b border-border/60 px-3 py-3 last:border-b-0"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-foreground/5 text-muted-foreground">
                  <ProviderIcon kind={agent.kind} className="size-4" />
                </span>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {agent.displayName}
                    </span>
                    <Badge tone={badgeToneForAgentStatus(status.tone)}>
                      {status.label}
                    </Badge>
                  </div>
                  <p className="text-sm leading-5 text-muted-foreground">
                    {configurationDetailForAgent(agent, reconcileResult)}
                  </p>
                  {agent.expectedEnvVars.length > 0 ? (
                    <p className="text-xs text-muted-foreground/80">
                      Expected credentials: {agent.expectedEnvVars.join(", ")}
                    </p>
                  ) : null}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={!issueAction}
                  loading={issueAction?.loading ?? false}
                  onClick={issueAction?.onClick}
                >
                  {issueAction?.label ?? "Review setup"}
                </Button>
              </div>

              {authTerminalSession ? (
                <div className="pl-11">
                  <AgentLoginTerminalPanel
                    session={authTerminalSession}
                    baseUrl={authTerminalConnection.baseUrl}
                    authToken={authTerminalConnection.authToken}
                    onClose={(kind) => {
                      onCloseAuthTerminal(kind);
                    }}
                    onExit={(kind, code) => {
                      onAuthTerminalExit(kind, code);
                    }}
                    onRestart={() => {
                      onRestartAuthTerminal(agent);
                    }}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </AgentDefaultsSection>
  );
}
