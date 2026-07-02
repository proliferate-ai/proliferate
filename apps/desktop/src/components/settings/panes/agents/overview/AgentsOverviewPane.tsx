import type { AgentSummary } from "@anyharness/sdk";
import { InstallGate } from "@proliferate/product-ui/settings/InstallGate";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronRight, RefreshCw, Robot } from "@proliferate/ui/icons";
import { AgentGlyph } from "@proliferate/ui/provider-icons";
import { useMemo } from "react";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import type { SettingsSection } from "@/config/settings";
import { AGENTS_OVERVIEW_COPY } from "@/copy/agents/agents-overview-copy";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { useAgentInstallationActions } from "@/hooks/agents/workflows/use-agent-installation-actions";
import { getSettingsSectionForHarnessKind } from "@/lib/domain/settings/navigation-presentation";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  formatAgentOverviewMeta,
  getAgentOverviewStatus,
  getInstalledAgents,
} from "./agents-overview-presentation";

export interface AgentsOverviewPaneProps {
  onSelectSection: (section: SettingsSection) => void;
}

export function AgentsOverviewPane({ onSelectSection }: AgentsOverviewPaneProps) {
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const runtimeError = useHarnessConnectionStore((state) => state.error);
  const showToast = useToastStore((state) => state.show);
  const { agents, isLoading: agentsLoading, isReconciling } = useAgentCatalog();
  const { reconcileAgents } = useAgentInstallationActions();
  const installedAgents = useMemo(() => getInstalledAgents(agents), [agents]);
  const canRefresh = connectionState === "healthy" && !isReconciling;

  const handleRefresh = () => {
    void reconcileAgents()
      .then(() => {
        showToast(AGENTS_OVERVIEW_COPY.refreshStarted, "info");
      })
      .catch((error) => {
        showToast(error instanceof Error ? error.message : String(error));
      });
  };

  return (
    <section className="space-y-5">
      <SettingsPageHeader
        title={AGENTS_OVERVIEW_COPY.title}
        description={AGENTS_OVERVIEW_COPY.description}
        action={
          <Button
            variant="ghost"
            size="sm"
            type="button"
            disabled={!canRefresh}
            onClick={handleRefresh}
            className="gap-2"
          >
            <RefreshCw className={`size-3.5 ${isReconciling ? "animate-spin" : ""}`} />
            {isReconciling
              ? AGENTS_OVERVIEW_COPY.refreshing
              : AGENTS_OVERVIEW_COPY.refresh}
          </Button>
        }
      />

      {connectionState === "connecting" ? (
        <LoadingState
          message={AGENTS_OVERVIEW_COPY.connectingMessage}
          subtext={AGENTS_OVERVIEW_COPY.connectingSubtext}
        />
      ) : connectionState === "failed" ? (
        <div className="space-y-1 py-3">
          <p className="text-sm font-medium text-foreground">
            {AGENTS_OVERVIEW_COPY.unavailableTitle}
          </p>
          <p className="text-xs text-muted-foreground">
            {runtimeError ?? AGENTS_OVERVIEW_COPY.unavailableDescription}
          </p>
        </div>
      ) : agentsLoading && agents.length === 0 ? (
        <LoadingState
          message={AGENTS_OVERVIEW_COPY.loadingMessage}
          subtext={AGENTS_OVERVIEW_COPY.loadingSubtext}
        />
      ) : installedAgents.length === 0 ? (
        <InstallGate
          icon={<Robot aria-hidden="true" />}
          title={AGENTS_OVERVIEW_COPY.installGate.title}
          description={AGENTS_OVERVIEW_COPY.installGate.description}
          action={
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled={!canRefresh}
              onClick={handleRefresh}
            >
              {AGENTS_OVERVIEW_COPY.installGate.action}
            </Button>
          }
        />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {installedAgents.map((agent) => {
            const harnessSection = getSettingsSectionForHarnessKind(agent.kind);
            return (
              <AgentOverviewRow
                key={agent.kind}
                agent={agent}
                onOpen={harnessSection ? () => onSelectSection(harnessSection) : null}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function AgentOverviewRow({
  agent,
  onOpen,
}: {
  agent: AgentSummary;
  /** Null when the harness has no settings page of its own — renders a static row. */
  onOpen: (() => void) | null;
}) {
  const status = getAgentOverviewStatus(agent);
  const content = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-foreground">
        <AgentGlyph agentKind={agent.kind} className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-5 text-foreground">
          {agent.displayName}
        </span>
        <span className="block truncate text-xs leading-5 text-muted-foreground">
          {formatAgentOverviewMeta(agent)}
        </span>
      </span>
      <Badge tone={status.tone}>{status.label}</Badge>
    </>
  );
  const rowClass = "flex min-h-14 w-full items-center gap-3 px-3.5 py-2.5 text-left";
  if (!onOpen) {
    return <div className={rowClass}>{content}</div>;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${rowClass} transition-colors hover:bg-accent`}
    >
      {content}
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}
