import type { AgentSummary, ReconcileAgentResult } from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { AgentAuthTerminalPanel } from "@/components/agents/AgentAuthTerminalPanel";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { AgentDefaultsSection } from "@/components/settings/panes/agent-defaults/AgentDefaultsSection";
import { useAgentAuthTerminalWorkflow } from "@/hooks/agents/workflows/use-agent-auth-terminal-workflow";
import {
  badgeToneForAgentStatus,
  configurationDetailForAgent,
} from "@/lib/domain/agents/configuration-issues-presentation";
import { getAgentStatusDisplay } from "@/lib/domain/agents/status-presentation";

export function AgentConfigurationIssuesSection({
  agents,
  agentsLoading,
  isReconciling,
  reconcileResultsByKind,
  authTerminalWorkflow,
  onOpenAuthentication,
  onReviewSetup,
}: {
  agents: AgentSummary[];
  agentsLoading: boolean;
  isReconciling: boolean;
  reconcileResultsByKind: Map<string, ReconcileAgentResult>;
  authTerminalWorkflow: ReturnType<typeof useAgentAuthTerminalWorkflow>;
  onOpenAuthentication: (agentKind: string) => void;
  onReviewSetup: (agent: AgentSummary) => void;
}) {
  return (
    <AgentDefaultsSection
      title="Needs configuration"
      description="These harnesses are installed or known, but cannot be used as launch defaults yet."
    >
      <SettingsCard>
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
          const canOpenInlineAuth = agent.readiness === "login_required"
            && agent.supportsLogin;
          const usesAuthenticationPage = agent.readiness === "credentials_required"
            || (agent.readiness === "login_required" && !agent.supportsLogin);
          const authTerminalSession = authTerminalWorkflow.sessionsByKind[agent.kind] ?? null;
          const authActionLabel = authTerminalSession?.isStarting
            ? "Opening..."
            : authTerminalSession?.terminal
              ? "Restart auth"
              : authTerminalSession?.errorMessage
                ? "Retry auth"
                : "Open auth";

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
                  loading={authTerminalSession?.isStarting ?? false}
                  onClick={() => {
                    if (canOpenInlineAuth) {
                      void authTerminalWorkflow.openAuthTerminal(agent, {
                        restart: Boolean(authTerminalSession),
                      });
                      return;
                    }
                    if (usesAuthenticationPage) {
                      onOpenAuthentication(agent.kind);
                      return;
                    }
                    onReviewSetup(agent);
                  }}
                >
                  {canOpenInlineAuth
                    ? authActionLabel
                    : usesAuthenticationPage
                      ? "Open auth"
                      : "Review setup"}
                </Button>
              </div>

              {authTerminalSession ? (
                <div className="pl-11">
                  <AgentAuthTerminalPanel
                    session={authTerminalSession}
                    baseUrl={authTerminalWorkflow.runtimeConnection.baseUrl}
                    authToken={authTerminalWorkflow.runtimeConnection.authToken}
                    onClose={(kind) => {
                      void authTerminalWorkflow.closeAuthTerminal(kind);
                    }}
                    onExit={(kind, code) => {
                      void authTerminalWorkflow.handleTerminalExit(kind, code);
                    }}
                    onRestart={() => {
                      void authTerminalWorkflow.openAuthTerminal(agent, { restart: true });
                    }}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </SettingsCard>
    </AgentDefaultsSection>
  );
}
