import { useEffect, useMemo, useRef, useState } from "react";
import { CloudIcon, Monitor } from "@proliferate/ui/icons";
import {
  SegmentedControl,
  type SegmentedControlItem,
} from "@proliferate/ui/primitives/SegmentedControl";
import { Tabs, type TabItem } from "@proliferate/ui/primitives/Tabs";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import {
  DirectRuntimeAttachChip,
  DirectRuntimeAttachDot,
} from "@/components/compute/DirectRuntimeAttachChip";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";
import { useCloudTargets } from "@/hooks/access/cloud/targets/use-cloud-targets";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useDirectRuntimeAttachStateResolver } from "@/hooks/compute/derived/use-direct-runtime-attach-states";
import { useLoopbackRuntimeDisplayName } from "@/hooks/compute/derived/use-loopback-runtime-name";
import { useComputeTargetAppearancePreferences } from "@/hooks/settings/workflows/use-ssh-direct-target-profile";
import { directRuntimeEditsDeferred } from "@/lib/domain/compute/direct-runtime-presentation";
import { getProviderDisplayName } from "@/lib/domain/agents/provider-display";
import {
  AGENTS_RUNTIME_SCOPE_THIS_MAC_ID,
  agentsRuntimeScopeForId,
  agentsRuntimeScopeIdForTarget,
  buildAgentsRuntimeScopeOptions,
} from "@/lib/domain/settings/agents-runtime-scope";
import { HarnessAllModelsSection } from "./HarnessAllModelsSection";
import { HarnessAuthenticationSection } from "./HarnessAuthenticationSection";
import { HarnessSettingsSection } from "./HarnessSettingsSection";
import { OpenCodeHarnessAuthSection } from "./OpenCodeHarnessAuthSection";

const SUBTABS = [
  { id: "authentication", label: HARNESS_PANE_COPY.tabAuthentication },
  { id: "models", label: HARNESS_PANE_COPY.tabAllModels },
] as const satisfies readonly TabItem[];

type HarnessSubtab = (typeof SUBTABS)[number]["id"];

interface HarnessPaneProps {
  harnessKind: string;
  /** Deep link: preselect one enrolled runtime's scope (focus.target). */
  initialTargetId?: string | null;
}

export function HarnessPane({ harnessKind, initialTargetId = null }: HarnessPaneProps) {
  // The runtime-scope axis: cloud plus the direct family (This Mac + every
  // enrolled ssh target). Every section below reads/writes the selected
  // scope's (surface, targetId).
  const [scopeId, setScopeId] = useState<string>(
    initialTargetId
      ? agentsRuntimeScopeIdForTarget(initialTargetId)
      : AGENTS_RUNTIME_SCOPE_THIS_MAC_ID,
  );
  const [subtab, setSubtab] = useState<HarnessSubtab>("authentication");
  const { agentsByKind } = useAgentCatalog();
  const { cloudActive } = useCloudAvailabilityState();
  const targetsQuery = useCloudTargets(cloudActive);
  const appearancePreferences = useComputeTargetAppearancePreferences();
  const loopbackDisplayName = useLoopbackRuntimeDisplayName();
  const getAttachState = useDirectRuntimeAttachStateResolver();

  const consumedInitialTargetIdRef = useRef<string | null>(initialTargetId);
  useEffect(() => {
    if (initialTargetId && consumedInitialTargetIdRef.current !== initialTargetId) {
      consumedInitialTargetIdRef.current = initialTargetId;
      setScopeId(agentsRuntimeScopeIdForTarget(initialTargetId));
    }
  }, [initialTargetId]);

  const scopeOptions = useMemo(
    () =>
      buildAgentsRuntimeScopeOptions({
        targets: targetsQuery.data,
        appearancePreferences: appearancePreferences.preferences,
        loopbackDisplayName,
      }),
    [appearancePreferences.preferences, loopbackDisplayName, targetsQuery.data],
  );
  // A stale scope id (archived target, unresolved deep link) falls back to
  // This Mac rather than rendering an unselectable control.
  const effectiveScopeId = scopeOptions.some((option) => option.id === scopeId)
    ? scopeId
    : AGENTS_RUNTIME_SCOPE_THIS_MAC_ID;
  const scope = agentsRuntimeScopeForId(effectiveScopeId, scopeOptions);
  const { surface, targetId } = scope;
  const attachState = getAttachState(targetId);

  const scopeItems: SegmentedControlItem[] = scopeOptions.map((option) => ({
    id: option.id,
    label: option.label,
    icon: option.scope.surface === "cloud"
      ? <CloudIcon />
      : option.scope.targetId === null
        ? <Monitor />
        : <DirectRuntimeAttachDot state={getAttachState(option.scope.targetId)} />,
  }));

  const displayName =
    agentsByKind.get(harnessKind)?.displayName ?? getProviderDisplayName(harnessKind);

  return (
    <section className="space-y-5">
      <SettingsPageHeader
        title={displayName}
        action={
          <SegmentedControl
            items={scopeItems}
            value={effectiveScopeId}
            onChange={setScopeId}
          />
        }
      />

      <Tabs
        items={SUBTABS}
        activeId={subtab}
        onChange={(id) => setSubtab(id === "models" ? "models" : "authentication")}
      />

      {targetId !== null && directRuntimeEditsDeferred(attachState) ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <DirectRuntimeAttachChip state={attachState} />
          {HARNESS_PANE_COPY.editsDeferredNote}
        </p>
      ) : null}

      {subtab === "authentication" ? (
        <>
          {harnessKind === "opencode" ? (
            <OpenCodeHarnessAuthSection
              displayName={displayName}
              surface={surface}
              targetId={targetId}
            />
          ) : (
            <HarnessAuthenticationSection
              harnessKind={harnessKind}
              displayName={displayName}
              surface={surface}
              targetId={targetId}
            />
          )}
          <HarnessSettingsSection harnessKind={harnessKind} />
        </>
      ) : (
        <HarnessAllModelsSection
          harnessKind={harnessKind}
          displayName={displayName}
          surface={surface}
          targetId={targetId}
        />
      )}
    </section>
  );
}
