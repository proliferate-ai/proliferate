import type { AgentSummary } from "@anyharness/sdk";
import {
  AGENTS_PAGE_COPY,
  AGENT_STATUS_TONE_BADGE_CLASSNAMES,
} from "@/config/agents";
import { type AgentStatusDisplay } from "@/lib/domain/agents/status";
import { useAgentsPaneState } from "@/hooks/agents/use-agents-pane-state";
import { AgentSetupModal } from "@/components/agents/AgentSetupModal";
import { Badge } from "@/components/ui/Badge";
import { ProviderIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { SettingsCard } from "./SettingsCard";
import { SettingsCardRow } from "./SettingsCardRow";
import { SettingsPageHeader } from "./SettingsPageHeader";

export function AgentsPane() {
  const state = useAgentsPaneState();
  const runtimeStatus = state.connectionState === "healthy"
    ? {
        label: "Connected",
        tone: "success" as const,
        description: state.runtimeVersion
          ? `${AGENTS_PAGE_COPY.runtimeVersionPrefix}${state.runtimeVersion}`
          : "Connected to the local AnyHarness runtime.",
      }
    : state.connectionState === "connecting"
      ? {
          label: "Connecting",
          tone: "muted" as const,
          description: AGENTS_PAGE_COPY.reconnectLoadingSubtext,
        }
      : {
          label: "Unavailable",
          tone: "destructive" as const,
          description: state.runtimeError ?? AGENTS_PAGE_COPY.reconnectTitle,
        };

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title={AGENTS_PAGE_COPY.title}
        description={AGENTS_PAGE_COPY.description}
      />

      {state.reconcileError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {state.reconcileError}
        </div>
      )}

      <SettingsCard>
        <SettingsCardRow
          label="AnyHarness runtime"
          description={runtimeStatus.description}
        >
          <Badge className={`!text-xs ${AGENT_STATUS_TONE_BADGE_CLASSNAMES[runtimeStatus.tone]}`}>
            {runtimeStatus.label}
          </Badge>
        </SettingsCardRow>
        {state.connectionState === "healthy" && (
          <SettingsCardRow
            label="Agent reconciliation"
            description="Reinstall the available runtimes and refresh their setup state."
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void state.handleReconcile();
              }}
              disabled={state.isReconciling || state.isAgentSeedHydrating}
            >
              {state.isAgentSeedHydrating
                ? AGENTS_PAGE_COPY.reconcileSeedHydratingAction
                : state.isReconciling
                  ? AGENTS_PAGE_COPY.reconcileLoadingAction
                  : AGENTS_PAGE_COPY.reconcileAction}
            </Button>
          </SettingsCardRow>
        )}
      </SettingsCard>

      {state.connectionState === "connecting" && (
        <SettingsCard>
          <div className="p-3">
            <LoadingState
              message={AGENTS_PAGE_COPY.reconnectLoadingMessage}
              subtext={AGENTS_PAGE_COPY.reconnectLoadingSubtext}
            />
          </div>
        </SettingsCard>
      )}

      {state.connectionState === "healthy" && (
        <SettingsCard>
          <div className="flex items-center justify-between gap-4 p-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">Available agents</div>
              <div className="text-sm text-muted-foreground">
                Install and manage each agent runtime and its authentication flow.
              </div>
            </div>
            <div className="shrink-0 rounded-full border border-border bg-background/70 px-2.5 py-1 text-xs text-muted-foreground">
              {state.rows.length} total
            </div>
          </div>

          {state.agentsLoading && state.isEmpty ? (
            <div className="border-t border-border/40 p-3">
              <LoadingState
                message={AGENTS_PAGE_COPY.loadingMessage}
                subtext={AGENTS_PAGE_COPY.loadingSubtext}
              />
            </div>
          ) : state.agentError ? (
            <div className="border-t border-border/40 p-3">
              <p className="text-sm text-muted-foreground">
                {AGENTS_PAGE_COPY.loadErrorTitle}
              </p>
              <p className="mt-1 text-sm text-muted-foreground/70">
                {state.agentError}
              </p>
            </div>
          ) : state.isEmpty ? (
            <p className="border-t border-border/40 px-4 py-6 text-center text-sm text-muted-foreground">
              {AGENTS_PAGE_COPY.empty}
            </p>
          ) : (
            state.rows.map((row) => (
              <AgentRow
                key={row.agent.kind}
                row={row}
                onOpen={() => state.openAgent(row.agent)}
              />
            ))
          )}
        </SettingsCard>
      )}

      {state.selectedAgent && (
        <AgentSetupModal
          key={state.selectedAgent.kind}
          agent={state.selectedAgent}
          onClose={state.closeAgent}
          reconcileState={state.reconcileState}
          runtimeHome={state.runtimeHome}
          anyHarnessLogPath={state.anyHarnessLogPath}
          reconcileResult={
            state.rows.find((row) => row.agent.kind === state.selectedAgent?.kind)
              ?.reconcileResult
          }
        />
      )}
    </section>
  );
}

function AgentRow({
  row,
  onOpen,
}: {
  row: {
    agent: AgentSummary;
    status: AgentStatusDisplay;
    detailText: string;
    actionLabel: string;
    actionVariant: "outline" | "primary";
    actionDisabled: boolean;
  };
  onOpen: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border/40 p-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/5">
          <ProviderIcon kind={row.agent.kind} className="size-5 shrink-0" />
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-sm font-medium">
              {row.agent.displayName}
            </div>
            <Badge className={`!text-xs ${AGENT_STATUS_TONE_BADGE_CLASSNAMES[row.status.tone]}`}>
              {row.status.label}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground/80">
            {row.detailText}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant={row.actionVariant}
          size="sm"
          onClick={onOpen}
          disabled={row.actionDisabled}
        >
          {row.actionLabel}
        </Button>
      </div>
    </div>
  );
}
