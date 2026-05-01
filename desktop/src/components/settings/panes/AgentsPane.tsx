import type { AgentSummary } from "@anyharness/sdk";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AGENTS_PAGE_COPY } from "@/config/agents";
import type { AgentsPaneRowState } from "@/hooks/agents/use-agents-pane-state";
import { useAgentsPaneState } from "@/hooks/agents/use-agents-pane-state";
import { AgentSetupModal } from "@/components/agents/AgentSetupModal";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ProviderIcon } from "@/components/ui/icons";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import {
  getAgentGroupBadgeTone,
} from "@/lib/domain/agents/groups";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsCardRow } from "@/components/settings/SettingsCardRow";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";

const AGENTS_PANE_BADGE_CLASSNAMES = {
  neutral: "border-border/60 bg-muted/35 text-muted-foreground",
  destructive: "border-destructive/20 bg-destructive/10 text-destructive",
} as const;

export function AgentsPane() {
  const state = useAgentsPaneState();
  const navigate = useNavigate();

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title={AGENTS_PAGE_COPY.title}
        description={AGENTS_PAGE_COPY.description}
      />

      {state.installError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {state.installError}
        </div>
      )}

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

      {state.connectionState === "failed" && (
        <SettingsCard>
          <div className="space-y-1 p-3">
            <p className="text-sm font-medium text-foreground">
              {AGENTS_PAGE_COPY.connectionUnavailableTitle}
            </p>
            <p className="text-sm text-muted-foreground">
              {state.connectionDescription}
            </p>
          </div>
        </SettingsCard>
      )}

      {state.connectionState === "healthy" && (
        <>
          {state.agentsLoading && state.isEmpty ? (
            <SettingsCard>
              <div className="p-3">
                <LoadingState
                  message={AGENTS_PAGE_COPY.loadingMessage}
                  subtext={AGENTS_PAGE_COPY.loadingSubtext}
                />
              </div>
            </SettingsCard>
          ) : state.agentError ? (
            <SettingsCard>
              <div className="space-y-1 p-3">
                <p className="text-sm font-medium text-foreground">
                  {AGENTS_PAGE_COPY.loadErrorTitle}
                </p>
                <p className="text-sm text-muted-foreground">
                  {state.agentError}
                </p>
              </div>
            </SettingsCard>
          ) : state.isEmpty ? (
            <SettingsCard>
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {AGENTS_PAGE_COPY.empty}
              </p>
            </SettingsCard>
          ) : (
            <>
              <AgentRowsSection
                title={AGENTS_PAGE_COPY.needsSetupSectionTitle}
                description={AGENTS_PAGE_COPY.needsSetupSectionDescription}
                rows={state.needsSetupRows}
                onOpen={state.openAgent}
                onInstall={state.handleInstallAgent}
              />
              <AgentRowsSection
                title={AGENTS_PAGE_COPY.configuredSectionTitle}
                description={AGENTS_PAGE_COPY.configuredSectionDescription}
                rows={state.configuredRows}
                onOpen={state.openAgent}
                onInstall={state.handleInstallAgent}
              />
              <AgentRowsSection
                title={AGENTS_PAGE_COPY.unavailableSectionTitle}
                description={AGENTS_PAGE_COPY.unavailableSectionDescription}
                rows={state.unavailableRows}
                onOpen={state.openAgent}
                onInstall={state.handleInstallAgent}
              />
            </>
          )}
        </>
      )}

      <AgentsSection
        title={AGENTS_PAGE_COPY.defaultsSectionTitle}
        description={AGENTS_PAGE_COPY.defaultsSectionDescription}
      >
        <SettingsCard>
          <SettingsCardRow
            label={AGENTS_PAGE_COPY.defaultsLabel}
            description={AGENTS_PAGE_COPY.defaultsDescription}
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(buildSettingsHref({ section: "agent-defaults" }))}
            >
              {AGENTS_PAGE_COPY.defaultsAction}
            </Button>
          </SettingsCardRow>
        </SettingsCard>
      </AgentsSection>

      <AgentReconciliationSection
        connectionState={state.connectionState}
        isAgentOperationActive={state.isAgentOperationActive}
        isAgentSeedHydrating={state.isAgentSeedHydrating}
        isReconciling={state.isReconciling}
        reconcileError={state.reconcileError}
        onReconcile={state.handleReconcile}
      />

      {state.selectedAgent && (
        <AgentSetupModal
          key={state.selectedAgent.kind}
          agent={state.selectedAgent}
          onClose={state.closeAgent}
          reconcileState={state.reconcileState}
          runtimeHome={state.runtimeHome}
          anyHarnessLogPath={state.anyHarnessLogPath}
          reconcileResult={state.selectedAgentReconcileResult}
        />
      )}
    </section>
  );
}

function AgentReconciliationSection({
  connectionState,
  isAgentOperationActive,
  isAgentSeedHydrating,
  isReconciling,
  reconcileError,
  onReconcile,
}: {
  connectionState: "connecting" | "healthy" | "failed";
  isAgentOperationActive: boolean;
  isAgentSeedHydrating: boolean;
  isReconciling: boolean;
  reconcileError: string | null;
  onReconcile: () => Promise<void>;
}) {
  return (
    <AgentsSection
      title={AGENTS_PAGE_COPY.reconcileSectionTitle}
      description={AGENTS_PAGE_COPY.reconcileSectionDescription}
    >
      <SettingsCard>
        {reconcileError && (
          <div className="px-3 py-2 text-xs text-destructive">
            {reconcileError}
          </div>
        )}
        <SettingsCardRow
          label={AGENTS_PAGE_COPY.reconcileLabel}
          description={AGENTS_PAGE_COPY.reconcileDescription}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void onReconcile();
            }}
            disabled={
              connectionState !== "healthy"
              || isAgentOperationActive
              || isAgentSeedHydrating
            }
          >
            {isAgentSeedHydrating
              ? AGENTS_PAGE_COPY.reconcileSeedHydratingAction
              : isReconciling
                ? AGENTS_PAGE_COPY.reconcileLoadingAction
                : AGENTS_PAGE_COPY.reconcileAction}
          </Button>
        </SettingsCardRow>
      </SettingsCard>
    </AgentsSection>
  );
}

function AgentsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

function AgentRowsSection({
  title,
  description,
  rows,
  onOpen,
  onInstall,
}: {
  title: string;
  description: string;
  rows: AgentsPaneRowState[];
  onOpen: (agent: AgentSummary) => void;
  onInstall: (agent: AgentSummary) => void;
}) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <AgentsSection title={title} description={description}>
      <SettingsCard>
        {rows.map((row) => (
          <AgentRow
            key={row.agent.kind}
            row={row}
            onOpen={() => onOpen(row.agent)}
            onInstall={() => onInstall(row.agent)}
          />
        ))}
      </SettingsCard>
    </AgentsSection>
  );
}

function AgentRow({
  row,
  onOpen,
  onInstall,
}: {
  row: AgentsPaneRowState;
  onOpen: () => void;
  onInstall: () => void;
}) {
  const badgeTone = getAgentGroupBadgeTone(row.group, row.status.tone);

  return (
    <div className="flex items-center justify-between gap-4 p-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/5">
          <ProviderIcon kind={row.agent.kind} className="size-5 shrink-0" />
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-sm font-medium">
              {row.agent.displayName}
            </div>
            <Badge className={`!text-xs ${AGENTS_PANE_BADGE_CLASSNAMES[badgeTone]}`}>
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
          variant="ghost"
          size="sm"
          onClick={onInstall}
          disabled={row.installActionDisabled}
          loading={row.installActionLoading}
        >
          {row.installActionLabel}
        </Button>
        <Button
          variant="outline"
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
