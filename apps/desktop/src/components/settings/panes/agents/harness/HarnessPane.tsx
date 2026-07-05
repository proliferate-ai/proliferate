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
    <section className="space-y-6">
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

      {/* Two-column setup surface: the auth/config hero panel reads as its own
          distinct setup card on the left, with the model catalog as a quieter
          reference column on the right. Stacks vertically below `lg`. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="w-full shrink-0 divide-y divide-border overflow-hidden rounded-lg border border-border bg-foreground/[0.02] lg:w-[360px]">
          <HarnessAuthSection
            harnessKind={harnessKind}
            displayName={displayName}
            surface={surface}
            editor={editor}
            variant="panel"
          />

          <HarnessAuthDetailsSection
            harnessKind={harnessKind}
            displayName={displayName}
            surface={surface}
            selectedMethod={selectedMethod}
            editor={editor}
            variant="panel"
          />

          <HarnessSettingsSection harnessKind={harnessKind} variant="panel" />
        </div>

        <div className="min-w-0 flex-1">
          <HarnessAllModelsSection
            harnessKind={harnessKind}
            displayName={displayName}
            surface={surface}
          />
        </div>
      </div>
    </section>
  );
}
