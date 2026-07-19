import type { AgentSummary } from "@anyharness/sdk";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { SegmentedControl } from "@proliferate/ui/primitives/SegmentedControl";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { Laptop, Server } from "lucide-react";
import {
  useAnyHarnessRuntimeContext,
  useAnyHarnessWorkspaceContext,
} from "@anyharness/sdk-react";
import { useEffect, useState } from "react";
import { CloudGuard } from "#product/components/cloud/CloudGuard";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import { getProviderDisplayName } from "#product/lib/domain/agents/provider-display";
import { useAgentSurfaceStore } from "#product/stores/ui/agent-surface-store";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import { HarnessAllModelsSection } from "#product/components/settings/panes/agents/harness/HarnessAllModelsSection";
import { HarnessAuthDetailsSection } from "#product/components/settings/panes/agents/harness/HarnessAuthDetailsSection";
import { HarnessAuthSection, deriveSelectedMethod } from "#product/components/settings/panes/agents/harness/HarnessAuthSection";
import { HarnessConfigIssueBanner } from "#product/components/settings/panes/agents/harness/HarnessConfigIssueBanner";
import { HarnessSettingsSection } from "#product/components/settings/panes/agents/harness/HarnessSettingsSection";
import { useHarnessAuthEditor } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import { useHarnessInstallAction } from "#product/hooks/agents/workflows/use-harness-install-action";
import { HarnessUpdateProgress } from "#product/components/settings/panes/agents/harness/HarnessUpdateProgress";
import { useWorkspaceAgentCatalog } from "#product/hooks/agents/derived/use-workspace-agent-catalog";
import { getAgentStatusDisplay } from "#product/lib/domain/agents/status-presentation";

interface HarnessPaneProps {
  harnessKind: string;
}

export function HarnessPane({ harnessKind }: HarnessPaneProps) {
  const surface = useAgentSurfaceStore((state) => state.surface);
  const { workspaceId } = useAnyHarnessWorkspaceContext();
  const { runtimeUrl } = useAnyHarnessRuntimeContext();
  const hasLocalRuntime = (runtimeUrl?.trim().length ?? 0) > 0;
  const [installTarget, setInstallTarget] = useState<"runtime" | "workspace">(
    () => hasLocalRuntime || !workspaceId ? "runtime" : "workspace",
  );
  useEffect(() => {
    if (!hasLocalRuntime && workspaceId && installTarget === "runtime") {
      setInstallTarget("workspace");
    } else if (!workspaceId && hasLocalRuntime && installTarget === "workspace") {
      setInstallTarget("runtime");
    }
  }, [hasLocalRuntime, installTarget, workspaceId]);
  const localCatalog = useAgentCatalog();
  const workspaceCatalog = useWorkspaceAgentCatalog({
    enabled: installTarget === "workspace" && !!workspaceId,
  });
  const runtimeCatalog = installTarget === "workspace" ? workspaceCatalog : localCatalog;
  const {
    agentsByKind,
    agentsNeedingSetup,
    isError: runtimeCatalogIsError,
    isLoading: runtimeCatalogIsLoading,
    isReconciling,
    reconcileSnapshot,
  } = runtimeCatalog;

  const runtimeAgent = agentsByKind.get(harnessKind);
  const displayName = runtimeAgent?.displayName ?? getProviderDisplayName(harnessKind);
  const issueAgent = agentsNeedingSetup.find((agent) => agent.kind === harnessKind);
  const installAction = useHarnessInstallAction(
    issueAgent ?? null,
    installTarget,
  );
  const updateComponents = isReconciling
    ? reconcileSnapshot?.progress?.components.filter(
      (component) => component.agent === harnessKind,
    ) ?? []
    : [];

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title={displayName}
        description={HARNESS_PANE_COPY.surfaceDescription(surface, displayName)}
      />

      <SettingsSection
        title={HARNESS_PANE_COPY.runtimeTitle}
        description={HARNESS_PANE_COPY.runtimeDescription}
        action={(
          <SegmentedControl
            ariaLabel="Harness update target"
            value={installTarget}
            items={[
              {
                id: "runtime",
                label: "Local",
                icon: <Laptop />,
                disabled: !hasLocalRuntime,
              },
              {
                id: "workspace",
                label: "Workspace",
                icon: <Server />,
                disabled: !workspaceId,
              },
            ]}
            onChange={setInstallTarget}
          />
        )}
      >
        {updateComponents.length > 0 ? (
          <HarnessUpdateProgress
            components={updateComponents}
            displayName={displayName}
            targetLabel={installTarget === "workspace" ? "Selected workspace runtime" : "Local runtime"}
          />
        ) : issueAgent ? (
          <HarnessConfigIssueBanner agent={issueAgent} installAction={installAction} />
        ) : (
          <HarnessRuntimeStatusRow
            harnessKind={harnessKind}
            displayName={displayName}
            agent={runtimeAgent}
            targetLabel={installTarget === "workspace" ? "Selected workspace" : "Local runtime"}
            loading={runtimeCatalogIsLoading}
            error={runtimeCatalogIsError}
          />
        )}
      </SettingsSection>

      {surface === "cloud" ? (
        <HarnessSurfaceCloud harnessKind={harnessKind} displayName={displayName} />
      ) : (
        <HarnessSurfaceLocal harnessKind={harnessKind} displayName={displayName} />
      )}
    </section>
  );
}

function HarnessRuntimeStatusRow({
  harnessKind,
  displayName,
  agent,
  targetLabel,
  loading,
  error,
}: {
  harnessKind: string;
  displayName: string;
  agent: AgentSummary | undefined;
  targetLabel: string;
  loading: boolean;
  error: boolean;
}) {
  const status = agent ? getAgentStatusDisplay(agent) : null;
  const tone = status?.tone === "success"
    ? "success"
    : status?.tone === "warning"
      ? "warning"
      : status?.tone === "destructive"
        ? "destructive"
        : "neutral";
  const label = loading
    ? HARNESS_PANE_COPY.runtimeChecking
    : error
      ? HARNESS_PANE_COPY.runtimeUnavailable
      : status?.label ?? HARNESS_PANE_COPY.runtimeNotReported;
  const description = loading
    ? HARNESS_PANE_COPY.runtimeCheckingDescription
    : error
      ? HARNESS_PANE_COPY.runtimeUnavailableDescription
      : !agent
        ? HARNESS_PANE_COPY.runtimeNotReportedDescription(targetLabel)
        : agent.readiness === "ready" && agent.installState !== "installing"
          ? HARNESS_PANE_COPY.runtimeReadyDescription(targetLabel)
          : agent.readiness === "unsupported"
            ? HARNESS_PANE_COPY.runtimeUnsupportedDescription(targetLabel)
            : HARNESS_PANE_COPY.runtimeStatusDescription(label, targetLabel);

  return (
    <SettingsRow
      data-harness-runtime-state={loading ? "loading" : error ? "error" : agent?.readiness ?? "missing"}
      label={(
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-muted-foreground">
            <ProviderIcon kind={harnessKind} className="size-4" />
          </span>
          <span className="truncate">{displayName}</span>
        </span>
      )}
      description={description}
    >
      <Badge tone={tone}>{label}</Badge>
    </SettingsRow>
  );
}

function HarnessSurfaceCloud({
  harnessKind,
  displayName,
}: {
  harnessKind: string;
  displayName: string;
}) {
  const editor = useHarnessAuthEditor(harnessKind, displayName, "cloud");
  const selectedMethod = deriveSelectedMethod(editor);

  return (
    <CloudGuard>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-foreground/[0.02]">
        <HarnessAuthSection
          harnessKind={harnessKind}
          displayName={displayName}
          surface="cloud"
          editor={editor}
          variant="panel"
        />

        <HarnessAuthDetailsSection
          harnessKind={harnessKind}
          displayName={displayName}
          surface="cloud"
          selectedMethod={selectedMethod}
          editor={editor}
          variant="panel"
        />
      </div>

      <HarnessSettingsSection harnessKind={harnessKind} surface="cloud" variant="section" />

      <HarnessAllModelsSection
        harnessKind={harnessKind}
        displayName={displayName}
        surface="cloud"
      />
    </CloudGuard>
  );
}

function HarnessSurfaceLocal({
  harnessKind,
  displayName,
}: {
  harnessKind: string;
  displayName: string;
}) {
  const editor = useHarnessAuthEditor(harnessKind, displayName, "local");
  const selectedMethod = deriveSelectedMethod(editor);

  return (
    <>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-foreground/[0.02]">
        <HarnessAuthSection
          harnessKind={harnessKind}
          displayName={displayName}
          surface="local"
          editor={editor}
          variant="panel"
        />

        <HarnessAuthDetailsSection
          harnessKind={harnessKind}
          displayName={displayName}
          surface="local"
          selectedMethod={selectedMethod}
          editor={editor}
          variant="panel"
        />
      </div>

      <HarnessSettingsSection harnessKind={harnessKind} surface="local" variant="section" />

      <HarnessAllModelsSection
        harnessKind={harnessKind}
        displayName={displayName}
        surface="local"
      />
    </>
  );
}
