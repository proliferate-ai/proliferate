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
import { SettingsPageHeader } from "./SettingsPageHeader";

export function AgentsPane() {
  const state = useAgentsPaneState();

  const reconcileAction = state.connectionState === "healthy" ? (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        void state.handleReconcile();
      }}
      disabled={state.isReconciling}
    >
      {state.isReconciling
        ? AGENTS_PAGE_COPY.reconcileLoadingAction
        : AGENTS_PAGE_COPY.reconcileAction}
    </Button>
  ) : undefined;

  const description = [
    AGENTS_PAGE_COPY.description,
    state.connectionState === "healthy" && state.runtimeVersion
      ? `${AGENTS_PAGE_COPY.runtimeVersionPrefix}${state.runtimeVersion}`
      : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={AGENTS_PAGE_COPY.title}
        description={description}
        action={reconcileAction}
      />

      {state.connectionState === "connecting" && (
        <LoadingState
          message={AGENTS_PAGE_COPY.reconnectLoadingMessage}
          subtext={AGENTS_PAGE_COPY.reconnectLoadingSubtext}
        />
      )}

      {state.connectionState === "failed" && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {AGENTS_PAGE_COPY.reconnectTitle}
          </p>
          {state.runtimeError && (
            <p className="text-sm text-muted-foreground/70">
              {state.runtimeError}
            </p>
          )}
        </div>
      )}

      {state.connectionState === "healthy" && state.agentsLoading && state.isEmpty && (
        <LoadingState
          message={AGENTS_PAGE_COPY.loadingMessage}
          subtext={AGENTS_PAGE_COPY.loadingSubtext}
        />
      )}

      {state.connectionState === "healthy" && state.agentError && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {AGENTS_PAGE_COPY.loadErrorTitle}
          </p>
          <p className="text-sm text-muted-foreground/70">
            {state.agentError}
          </p>
        </div>
      )}

      {state.connectionState === "healthy" && !state.agentsLoading && !state.agentError && (
        <div className="space-y-3">
          {state.reconcileError && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {state.reconcileError}
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {state.rows.map((row, idx) => (
              <AgentRow
                key={row.agent.kind}
                row={row}
                isFirst={idx === 0}
                onOpen={() => state.openAgent(row.agent)}
              />
            ))}
            {state.isEmpty && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {AGENTS_PAGE_COPY.empty}
              </p>
            )}
          </div>
        </div>
      )}

      {state.selectedAgent && (
        <AgentSetupModal
          key={state.selectedAgent.kind}
          agent={state.selectedAgent}
          onClose={state.closeAgent}
          reconcileState={state.reconcileState}
          reconcileResult={
            state.rows.find((row) => row.agent.kind === state.selectedAgent?.kind)
              ?.reconcileResult
          }
        />
      )}
    </div>
  );
}

function AgentRow({
  row,
  isFirst,
  onOpen,
}: {
  row: {
    agent: AgentSummary;
    status: AgentStatusDisplay;
    actionLabel: string;
    actionVariant: "outline" | "primary";
    actionDisabled: boolean;
  };
  isFirst: boolean;
  onOpen: () => void;
}) {
  const showMessage = Boolean(row.agent.message && row.agent.readiness !== "ready");

  return (
    <div
      className={`flex items-center justify-between gap-4 px-4 py-3 ${
        isFirst ? "" : "border-t border-border/50"
      }`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/35">
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
          {showMessage ? (
            <p className="text-sm text-muted-foreground/80">
              {row.agent.message}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground/80">
              {row.agent.supportsLogin || row.agent.expectedEnvVars.length > 0
                ? "Credentials can be managed from the setup dialog."
                : "No additional credentials are required."}
            </p>
          )}
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
