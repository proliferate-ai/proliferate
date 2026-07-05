import { useState } from "react";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import { CloudIcon, Monitor } from "@proliferate/ui/icons";
import {
  SegmentedControl,
  type SegmentedControlItem,
} from "@proliferate/ui/primitives/SegmentedControl";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
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

  const editor = useHarnessAuthEditor(harnessKind, displayName, surface);
  const selectedMethod = deriveSelectedMethod(editor);

  return (
    <section className="max-w-4xl space-y-6">
      <SettingsPageHeader
        title={displayName}
        action={
          <SegmentedControl
            items={SURFACE_ITEMS}
            value={surface}
            onChange={setSurface}
          />
        }
      />

      <HarnessAuthSection
        harnessKind={harnessKind}
        displayName={displayName}
        surface={surface}
        editor={editor}
      />

      <HarnessAuthDetailsSection
        harnessKind={harnessKind}
        displayName={displayName}
        surface={surface}
        selectedMethod={selectedMethod}
        editor={editor}
      />

      <HarnessSettingsSection harnessKind={harnessKind} />

      <HarnessAllModelsSection
        harnessKind={harnessKind}
        displayName={displayName}
        surface={surface}
      />
    </section>
  );
}
