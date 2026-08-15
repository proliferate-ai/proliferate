import { useCallback, useMemo } from "react";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import { Switch } from "#product/primitives/Switch";
import { SettingsRow } from "#product/primitives/patterns/settings/SettingsRow";
import { SettingsGroup } from "#product/primitives/patterns/settings/SettingsGroup";
import {
  usePutAuthSelections,
  useAgentAuthState,
  useAuthSelections,
} from "@proliferate/cloud-sdk-react";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";

// --------------------------------------------------------------------------- #
// Catalog-declared settings (mirrors catalogs/agents/catalog.json)
// --------------------------------------------------------------------------- #

interface CatalogSetting {
  key: string;
  type: "boolean";
  label: string;
  description?: string;
  default: boolean;
  surfaces: AgentAuthSurface[];
}

const CATALOG_SETTINGS: Record<string, CatalogSetting[]> = {
  claude: [
    {
      key: "chrome",
      type: "boolean",
      label: "Use Claude Code with Chrome",
      description:
        "Allow Claude Code to control your Chrome browser. Requires the Claude Code Chrome extension.",
      default: false,
      surfaces: ["local"],
    },
  ],
};

// --------------------------------------------------------------------------- #
// Component
// --------------------------------------------------------------------------- #

interface HarnessSettingsSectionProps {
  harnessKind: string;
  surface: AgentAuthSurface;
}

/**
 * §6 — Harness-specific options. Untitled hairline-top group of setting rows
 * (Pablo 2026-07-28: no "Harness settings" heading — the rows are self-labeled).
 */
export function HarnessSettingsSection({
  harnessKind,
  surface,
}: HarnessSettingsSectionProps) {
  const allSettings = CATALOG_SETTINGS[harnessKind];
  const settings = allSettings?.filter((s) => s.surfaces.includes(surface));

  if (!settings || settings.length === 0) {
    return null;
  }

  return (
    <SettingsGroup>
      {settings.map((setting) => (
        <HarnessSettingRow
          key={setting.key}
          harnessKind={harnessKind}
          surface={surface}
          setting={setting}
        />
      ))}
    </SettingsGroup>
  );
}

// --------------------------------------------------------------------------- #
// Individual setting row
// --------------------------------------------------------------------------- #

function HarnessSettingRow({
  harnessKind,
  surface,
  setting,
}: {
  harnessKind: string;
  surface: AgentAuthSurface;
  setting: CatalogSetting;
}) {
  const { cloudActive } = useCloudAvailabilityState();
  // The "local" surface is a local CLI flag persisted through the desktop's
  // own backend — it must not require cloud sign-in. Only the "cloud" surface
  // depends on cloud compute being active. Mirrors HarnessAuthSection's
  // surface === "local" handling.
  const isLocalSurface = surface === "local";
  const queriesEnabled = isLocalSurface || cloudActive;
  const stateQuery = useAgentAuthState(surface, queriesEnabled);
  const selectionsQuery = useAuthSelections(surface, queriesEnabled);
  const putSelections = usePutAuthSelections();

  // Read persisted value from the auth state response.
  const harness = stateQuery.data?.harnesses?.find(
    (h) => h.harness_kind === harnessKind,
  );
  const persisted = harness?.settings as Record<string, boolean> | undefined;
  const currentValue = persisted?.[setting.key] ?? setting.default;

  // Build the current sources for this harness+surface so the PUT does not
  // clear them when we only want to toggle a setting.
  const currentSources = useMemo(() => {
    if (!selectionsQuery.data) return [];
    return selectionsQuery.data
      .filter((s) => s.harnessKind === harnessKind && s.surface === surface)
      .map((s) => ({
        sourceKind: s.sourceKind,
        apiKeyId: s.apiKeyId ?? undefined,
        envVarName: s.envVarName ?? undefined,
        providerHint: s.providerHint ?? undefined,
        enabled: s.enabled,
      }));
  }, [selectionsQuery.data, harnessKind, surface]);

  const handleToggle = useCallback(
    (next: boolean) => {
      const nextSettings = { ...persisted, [setting.key]: next };
      putSelections.mutate({
        harnessKind,
        surface,
        body: { sources: currentSources, settings: nextSettings },
      });
    },
    [harnessKind, surface, setting.key, persisted, currentSources, putSelections],
  );

  return (
    <SettingsRow label={setting.label} description={setting.description}>
      <Switch
        checked={currentValue}
        onChange={handleToggle}
        aria-label={setting.label}
        disabled={!isLocalSurface && !cloudActive}
      />
    </SettingsRow>
  );
}
