import type { AgentSummary } from "@anyharness/sdk";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
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
import { getAgentStatusDisplay } from "#product/lib/domain/agents/status-presentation";
import { HarnessInstallGate } from "#product/components/settings/panes/agents/harness/HarnessInstallGate";
import { CloudAnyHarnessRuntimeProvider } from "#product/providers/CloudAnyHarnessRuntimeProvider";

interface HarnessPaneProps {
  harnessKind: string;
}

const SETTINGS_HARNESS_DISPLAY_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  grok: "Grok",
  opencode: "OpenCode",
};

export function HarnessPane({ harnessKind }: HarnessPaneProps) {
  const surface = useAgentSurfaceStore((state) => state.surface);
  const displayName = SETTINGS_HARNESS_DISPLAY_NAMES[harnessKind]
    ?? getProviderDisplayName(harnessKind);

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title={displayName}
        description={HARNESS_PANE_COPY.surfaceDescription(surface, displayName)}
      />

      {surface === "cloud" ? (
        <CloudGuard>
          <CloudAnyHarnessRuntimeProvider>
            <HarnessRuntimeSurface harnessKind={harnessKind} surface="cloud" />
          </CloudAnyHarnessRuntimeProvider>
        </CloudGuard>
      ) : (
        <HarnessRuntimeSurface harnessKind={harnessKind} surface="local" />
      )}
    </section>
  );
}

function HarnessRuntimeSurface({
  harnessKind,
  surface,
}: {
  harnessKind: string;
  surface: AgentAuthSurface;
}) {
  const runtimeCatalog = useAgentCatalog();
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
  const installAction = useHarnessInstallAction(issueAgent ?? null, surface);
  const updateComponents = isReconciling
    ? reconcileSnapshot?.progress?.components.filter(
      (component) => component.agent === harnessKind,
    ) ?? []
    : [];
  const showRuntimeStatus = runtimeCatalogIsLoading
    || runtimeCatalogIsError
    || !runtimeAgent
    || runtimeAgent.readiness !== "ready"
    || runtimeAgent.installState === "installing";

  if (updateComponents.length > 0 || installAction) {
    return (
      <HarnessInstallGate
        harnessKind={harnessKind}
        displayName={displayName}
        surface={surface}
        installAction={installAction}
        installing={updateComponents.length > 0}
      />
    );
  }

  return (
    <>
      {showRuntimeStatus ? (
        <SettingsSection
          title={HARNESS_PANE_COPY.runtimeTitle}
          description={HARNESS_PANE_COPY.runtimeDescription(surface)}
        >
          {issueAgent ? (
            <HarnessConfigIssueBanner agent={issueAgent} />
          ) : (
            <HarnessRuntimeStatusRow
              harnessKind={harnessKind}
              displayName={displayName}
              agent={runtimeAgent}
              surface={surface}
              loading={runtimeCatalogIsLoading}
              error={runtimeCatalogIsError}
            />
          )}
        </SettingsSection>
      ) : null}

      {surface === "cloud" ? (
        <HarnessSurfaceCloud harnessKind={harnessKind} displayName={displayName} />
      ) : (
        <HarnessSurfaceLocal harnessKind={harnessKind} displayName={displayName} />
      )}
    </>
  );
}

function HarnessRuntimeStatusRow({
  harnessKind,
  displayName,
  agent,
  surface,
  loading,
  error,
}: {
  harnessKind: string;
  displayName: string;
  agent: AgentSummary | undefined;
  surface: AgentAuthSurface;
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
    ? HARNESS_PANE_COPY.runtimeCheckingDescription(surface)
    : error
      ? HARNESS_PANE_COPY.runtimeUnavailableDescription(surface)
      : !agent
        ? HARNESS_PANE_COPY.runtimeNotReportedDescription(surface)
        : agent.readiness === "ready" && agent.installState !== "installing"
          ? HARNESS_PANE_COPY.runtimeReadyDescription(surface)
          : agent.readiness === "unsupported"
            ? HARNESS_PANE_COPY.runtimeUnsupportedDescription(surface)
            : HARNESS_PANE_COPY.runtimeStatusDescription(label, surface);

  return (
    <SettingsRow
      data-harness-runtime-state={loading ? "loading" : error ? "error" : agent?.readiness ?? "missing"}
      label={(
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-muted-foreground">
            <ProviderIcon kind={harnessKind} className="icon-control" />
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
    <>
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
    </>
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
