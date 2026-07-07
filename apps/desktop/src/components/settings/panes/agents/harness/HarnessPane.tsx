import { useState } from "react";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import { CloudIcon, Monitor } from "@proliferate/ui/icons";
import {
  SegmentedControl,
  type SegmentedControlItem,
} from "@proliferate/ui/primitives/SegmentedControl";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { CloudGuard } from "@/components/cloud/CloudGuard";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { getProviderDisplayName } from "@/lib/domain/agents/provider-display";
import { HarnessAllModelsSection } from "./HarnessAllModelsSection";
import { HarnessAuthDetailsSection } from "./HarnessAuthDetailsSection";
import { HarnessAuthSection, deriveSelectedMethod } from "./HarnessAuthSection";
import { HarnessSettingsSection } from "./HarnessSettingsSection";
import { useHarnessAuthEditor } from "./use-harness-auth-editor";

const SURFACE_ITEMS: readonly SegmentedControlItem<AgentAuthSurface>[] = [
  { id: "cloud", label: HARNESS_PANE_COPY.surfaceCloud, icon: <CloudIcon /> },
  { id: "local", label: HARNESS_PANE_COPY.surfaceLocal, icon: <Monitor /> },
];

interface HarnessPaneProps {
  harnessKind: string;
}

export function HarnessPane({ harnessKind }: HarnessPaneProps) {
  const [surface, setSurface] = useState<AgentAuthSurface>("local");
  const { agentsByKind } = useAgentCatalog();

  const displayName =
    agentsByKind.get(harnessKind)?.displayName ?? getProviderDisplayName(harnessKind);

  return (
    <section className="space-y-6">
      <SettingsPageHeader title={displayName} />

      <div className="flex items-center gap-3">
        <SegmentedControl
          ariaLabel="Agent authentication surface"
          items={SURFACE_ITEMS}
          value={surface}
          onChange={setSurface}
        />
      </div>

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

        <HarnessSettingsSection harnessKind={harnessKind} variant="panel" />
      </div>

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

        <HarnessSettingsSection harnessKind={harnessKind} variant="panel" />
      </div>

      <HarnessAllModelsSection
        harnessKind={harnessKind}
        displayName={displayName}
        surface="local"
      />
    </>
  );
}
