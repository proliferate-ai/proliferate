import { useState } from "react";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import { CloudIcon, Monitor } from "@proliferate/ui/icons";
import {
  SegmentedControl,
  type SegmentedControlItem,
} from "@proliferate/ui/primitives/SegmentedControl";
import { Tabs, type TabItem } from "@proliferate/ui/primitives/Tabs";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { getProviderDisplayName } from "@/lib/domain/agents/provider-display";
import { HarnessAllModelsSection } from "./HarnessAllModelsSection";
import { HarnessAuthSection } from "./HarnessAuthSection";
import { HarnessSettingsSection } from "./HarnessSettingsSection";

const SURFACE_ITEMS: readonly SegmentedControlItem<AgentAuthSurface>[] = [
  { id: "cloud", label: HARNESS_PANE_COPY.surfaceCloud, icon: <CloudIcon /> },
  { id: "local", label: HARNESS_PANE_COPY.surfaceLocal, icon: <Monitor /> },
];

const SUBTABS = [
  { id: "authentication", label: HARNESS_PANE_COPY.tabAuthentication },
  { id: "models", label: HARNESS_PANE_COPY.tabAllModels },
] as const satisfies readonly TabItem[];

type HarnessSubtab = (typeof SUBTABS)[number]["id"];

interface HarnessPaneProps {
  harnessKind: string;
}

export function HarnessPane({ harnessKind }: HarnessPaneProps) {
  // The surface axis: every section below reads/writes the selected surface.
  const [surface, setSurface] = useState<AgentAuthSurface>("local");
  const [subtab, setSubtab] = useState<HarnessSubtab>("authentication");
  const { agentsByKind } = useAgentCatalog();

  const displayName =
    agentsByKind.get(harnessKind)?.displayName ?? getProviderDisplayName(harnessKind);

  return (
    <section className="space-y-5">
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

      <Tabs
        items={SUBTABS}
        activeId={subtab}
        onChange={(id) => setSubtab(id === "models" ? "models" : "authentication")}
      />

      {subtab === "authentication" ? (
        <>
          <HarnessAuthSection
            harnessKind={harnessKind}
            displayName={displayName}
            surface={surface}
          />
          <HarnessSettingsSection harnessKind={harnessKind} />
        </>
      ) : (
        <HarnessAllModelsSection
          harnessKind={harnessKind}
          displayName={displayName}
          surface={surface}
        />
      )}
    </section>
  );
}
