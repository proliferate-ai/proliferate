import { useState, type ReactNode } from "react";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import { Badge } from "#product/primitives/Badge";
import { Switch } from "#product/primitives/Switch";
import { RosterRow } from "#product/primitives/patterns/RosterRow";
import { SettingsSection } from "#product/primitives/patterns/settings/SettingsSection";
import { IntegrationIcon } from "#product/components/settings/panes/integrations/IntegrationIcon";
import { NativeIntegrationConsentDialog } from "#product/components/settings/panes/agents/harness/NativeIntegrationConsentDialog";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import {
  useNativeIntegrations,
  type NativeIntegrationRow,
} from "#product/hooks/agents/derived/use-native-integrations";
import { useNativeIntegrationSelection } from "#product/hooks/agents/workflows/use-native-integration-selection";

/**
 * "From your <Harness> setup" — the settings section where the user
 * re-admits pieces of their own harness installation (native MCP servers,
 * curated vendor bundles) into Proliferate sessions, one toggle per row.
 * Owner spec: `specs/systems/harnesses/native-integrations.md`, "Settings
 * surface". Local surface only: discovery is a fact about this machine's
 * harness install, and the cloud surface has none by law.
 *
 * Toggling ON any row with non-None risk (desktop control, browser control)
 * routes through the consent dialog; risk-None rows and every toggle-OFF
 * apply immediately. An empty discovery renders nothing — a harness with no
 * native setup should not grow an empty card.
 */
export function HarnessNativeIntegrationsSection({
  harnessKind,
  displayName,
  surface,
}: {
  harnessKind: string;
  displayName: string;
  surface: AgentAuthSurface;
}) {
  if (surface !== "local") {
    return null;
  }
  return (
    <LocalNativeIntegrationsSection harnessKind={harnessKind} displayName={displayName} />
  );
}

function LocalNativeIntegrationsSection({
  harnessKind,
  displayName,
}: {
  harnessKind: string;
  displayName: string;
}) {
  const { rows, isLoading, isError } = useNativeIntegrations(harnessKind, true);
  const selection = useNativeIntegrationSelection(harnessKind);
  const [consentRow, setConsentRow] = useState<NativeIntegrationRow | null>(null);

  // Loading renders nothing rather than a skeleton: the section's whole
  // presence is conditional on discovery finding anything, and a placeholder
  // card that then vanishes for most harnesses would be worse than a late
  // appearance.
  if (isLoading) return null;
  if (!isError && rows.length === 0) return null;

  const handleToggle = (row: NativeIntegrationRow, enabled: boolean) => {
    // Consent gates every enable of a capability with non-None risk (spec,
    // "Settings surface") — desktop control and browser control alike. Only
    // risk-None rows flip on immediately; every flip OFF is immediate.
    if (enabled && row.risk !== "none") {
      setConsentRow(row);
      return;
    }
    selection.setEnabled({ integrationId: row.id, enabled, displayName: row.displayName });
  };

  return (
    <>
      {/* Emphasized like its neighbours (Authentication above, Models below):
          the muted caption weight carries a px-0.5 inset that would leave
          this one title sitting 2px right of the pane's other headings. */}
      <SettingsSection
        title={HARNESS_PANE_COPY.nativeIntegrationsTitle(displayName)}
        description={HARNESS_PANE_COPY.nativeIntegrationsDescription(displayName)}
        titleWeight="emphasized"
        data-testid="harness-native-integrations"
      >
        {isError ? (
          <p className="px-3 py-2.5 text-ui-sm text-muted-foreground">
            {HARNESS_PANE_COPY.nativeIntegrationsLoadError(displayName)}
          </p>
        ) : (
          rows.map((row) => (
            <NativeIntegrationRosterRow
              key={row.id}
              row={row}
              busy={selection.isPending}
              onToggle={handleToggle}
            />
          ))
        )}
      </SettingsSection>
      {/* Outside the section: SettingsGroup draws a divider before every
          child, and the dialog (a portal, boxless when closed) must not earn
          one. */}
      <NativeIntegrationConsentDialog
        open={consentRow !== null}
        integrationId={consentRow?.id ?? ""}
        risk={consentRow?.risk ?? "desktop_control"}
        integrationDisplayName={consentRow?.displayName ?? ""}
        harnessDisplayName={displayName}
        loading={selection.isPending}
        onClose={() => setConsentRow(null)}
        onConfirm={() => {
          if (!consentRow) return;
          selection.setEnabled(
            {
              integrationId: consentRow.id,
              enabled: true,
              displayName: consentRow.displayName,
            },
            { onSettled: () => setConsentRow(null) },
          );
        }}
      />
    </>
  );
}

/**
 * The row's one subtitle line, by precedence. A stale row gets none — its
 * Missing badge is the whole story, and no discovered entry survives to
 * describe it. A raw row always keeps its config-file origin in mono — that
 * line is what identifies the entry, so a column of raw rows reads uniformly
 * — and an unavailable one appends why it cannot be turned on. A bundle row
 * shows its description, or, when unavailable, the reason in its place: the
 * reason names the missing artifact, which matters more than the blurb.
 */
function secondaryTextFor(row: NativeIntegrationRow): ReactNode {
  if (row.stale) return undefined;
  const reason = !row.available && row.unavailableReason ? row.unavailableReason : null;
  if (row.secondaryIsSource && row.secondary) {
    return (
      <>
        <span className="font-mono">{row.secondary}</span>
        {reason ? ` · ${reason}` : null}
      </>
    );
  }
  return reason ?? row.secondary ?? undefined;
}

function NativeIntegrationRosterRow({
  row,
  busy,
  onToggle,
}: {
  row: NativeIntegrationRow;
  busy: boolean;
  onToggle: (row: NativeIntegrationRow, enabled: boolean) => void;
}) {
  // An unavailable row cannot be turned ON (its artifacts are not on this
  // disk), but an already-enabled one can always be turned OFF — a
  // desktop-control selection must never be trapped in the on state behind a
  // disabled control. Stale rows are the same case: toggle still on, so the
  // user sees what to fix (spec, "Settings surface").
  const switchDisabled = busy || (!row.available && !row.enabled);

  return (
    <RosterRow
      density="comfortable"
      data-testid={`native-integration-${row.id}`}
      leading={<IntegrationIcon namespace={row.iconNamespace} />}
      title={row.displayName}
      secondary={secondaryTextFor(row)}
      trailing={(
        <span className="flex items-center gap-2">
          {row.stale ? (
            <Badge tone="destructive">{HARNESS_PANE_COPY.nativeIntegrationsBadgeMissing}</Badge>
          ) : null}
          {!row.stale && !row.available ? (
            <Badge tone="neutral">{HARNESS_PANE_COPY.nativeIntegrationsBadgeUnavailable}</Badge>
          ) : null}
          {row.risk === "desktop_control" ? (
            <Badge tone="warning">
              {HARNESS_PANE_COPY.nativeIntegrationsBadgeDesktopControl}
            </Badge>
          ) : null}
          {row.risk === "browser_control" ? (
            <Badge tone="warning">
              {HARNESS_PANE_COPY.nativeIntegrationsBadgeBrowserControl}
            </Badge>
          ) : null}
          <Switch
            checked={row.enabled}
            disabled={switchDisabled}
            aria-label={row.displayName}
            onChange={(enabled) => onToggle(row, enabled)}
          />
        </span>
      )}
    />
  );
}
