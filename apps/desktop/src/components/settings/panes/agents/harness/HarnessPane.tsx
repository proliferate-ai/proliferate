import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { CloudGuard } from "@/components/cloud/CloudGuard";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { getProviderDisplayName } from "@/lib/domain/agents/provider-display";
import { useAgentSurfaceStore } from "@/stores/ui/agent-surface-store";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";
import { HarnessAllModelsSection } from "./HarnessAllModelsSection";
import { HarnessAuthDetailsSection } from "./HarnessAuthDetailsSection";
import { HarnessAuthSection, deriveSelectedMethod } from "./HarnessAuthSection";
import { HarnessConfigIssueBanner } from "./HarnessConfigIssueBanner";
import { HarnessSettingsSection } from "./HarnessSettingsSection";
import { useHarnessAuthEditor } from "@/hooks/agents/workflows/use-harness-auth-editor";

interface HarnessPaneProps {
  harnessKind: string;
}

export function HarnessPane({ harnessKind }: HarnessPaneProps) {
  const surface = useAgentSurfaceStore((state) => state.surface);
  const { agentsByKind, agentsNeedingSetup } = useAgentCatalog();

  const displayName =
    agentsByKind.get(harnessKind)?.displayName ?? getProviderDisplayName(harnessKind);
  const issueAgent = agentsNeedingSetup.find((agent) => agent.kind === harnessKind);

  return (
    <section className="space-y-6">
      <SettingsPageHeader title={displayName} />

      {issueAgent ? <HarnessConfigIssueBanner agent={issueAgent} /> : null}

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
