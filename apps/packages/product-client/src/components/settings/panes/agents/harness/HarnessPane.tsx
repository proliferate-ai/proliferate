import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SegmentedControl } from "@proliferate/ui/primitives/SegmentedControl";
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
    isReconciling,
    reconcileSnapshot,
  } = runtimeCatalog;

  const displayName =
    agentsByKind.get(harnessKind)?.displayName ?? getProviderDisplayName(harnessKind);
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
      <SettingsPageHeader title={displayName} />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-foreground/[0.02] p-3">
        <div>
          <p className="text-ui-sm font-medium text-foreground">Harness update target</p>
          <p className="text-ui-xs text-muted-foreground">
            Choose the runtime whose CLI and ACP adapter are installed on disk.
          </p>
        </div>
        <SegmentedControl
          ariaLabel="Harness update target"
          value={installTarget}
          items={[
            {
              id: "runtime",
              label: "Local runtime",
              icon: <Laptop />,
              disabled: !hasLocalRuntime,
            },
            {
              id: "workspace",
              label: "Selected workspace",
              icon: <Server />,
              disabled: !workspaceId,
            },
          ]}
          onChange={setInstallTarget}
        />
      </div>

      {updateComponents.length > 0 ? (
        <HarnessUpdateProgress
          components={updateComponents}
          displayName={displayName}
          targetLabel={installTarget === "workspace" ? "Selected workspace runtime" : "Local runtime"}
        />
      ) : null}

      {issueAgent && updateComponents.length === 0 ? (
        <HarnessConfigIssueBanner agent={issueAgent} installAction={installAction} />
      ) : null}

      {surface === "cloud" ? (
        <HarnessSurfaceCloud harnessKind={harnessKind} displayName={displayName} />
      ) : (
        <HarnessSurfaceLocal harnessKind={harnessKind} displayName={displayName} />
      )}
    </section>
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
      <SettingsSection title={HARNESS_PANE_COPY.signInTitle}>
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
      </SettingsSection>

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
      <SettingsSection title={HARNESS_PANE_COPY.signInTitle}>
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
      </SettingsSection>

      <HarnessSettingsSection harnessKind={harnessKind} surface="local" variant="section" />

      <HarnessAllModelsSection
        harnessKind={harnessKind}
        displayName={displayName}
        surface="local"
      />
    </>
  );
}
