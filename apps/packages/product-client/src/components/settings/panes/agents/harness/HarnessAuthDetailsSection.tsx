import { SettingsSection } from "@proliferate/product-ui/patterns/SettingsSection";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import {
  isMultiSourceHarness,
  isRowComplete,
  type AuthMethod,
} from "#product/lib/domain/settings/harness-auth-sources";
import { isMultiSourceApiKeyActive } from "#product/components/settings/panes/agents/harness/HarnessAuthSection";
import { GatewayDetails } from "#product/components/settings/panes/agents/harness/HarnessAuthGatewayDetails";
import { CliDetails } from "#product/components/settings/panes/agents/harness/HarnessAuthCliDetails";
import { HarnessStatusRow } from "#product/components/settings/panes/agents/harness/HarnessStatusRow";

interface HarnessAuthDetailsSectionProps {
  harnessKind: string;
  // Single-source harnesses pass the resolved radio method; multi-source
  // harnesses ignore it and render the union of active status rows.
  selectedMethod: AuthMethod;
  editor: HarnessAuthEditorApi;
}

/**
 * §3 — Authenticated status. EVERY method (gateway, API key, native) reports
 * through `HarnessStatusRow`, so a user learns one status treatment instead of
 * three. The section is a flat stack of those rows; the API-key *editing*
 * surface is §4 and lives in its own section below.
 *
 * Multi-source (opencode): gateway, api_key and native all coexist, so the
 * section shows every applicable row at once rather than switching on a
 * selected method — nothing here is gated on a §2 choice.
 */
export function HarnessAuthDetailsSection({
  harnessKind,
  selectedMethod,
  editor,
}: HarnessAuthDetailsSectionProps) {
  const multiSource = isMultiSourceHarness(harnessKind);
  const showGateway = multiSource
    ? editor.editorState.gatewayEnabled
    : selectedMethod === "gateway";
  const showApiKey = multiSource
    ? isMultiSourceApiKeyActive(editor) || editor.editorState.rows.length > 0
    : selectedMethod === "api_key";
  // Native always participates for a multi-source harness (opencode's own
  // providers coexist with injected sources).
  const showNative = multiSource || selectedMethod === "cli";

  return (
    <SettingsSection title={HARNESS_PANE_COPY.statusTitle}>
      {showGateway ? <GatewayDetails editor={editor} /> : null}
      {showApiKey ? <ApiKeyStatusRow editor={editor} /> : null}
      {showNative ? <CliDetails editor={editor} /> : null}
    </SettingsSection>
  );
}

/**
 * The api_key status row. Saved state and live state coexist here by
 * construction (§3): `savedState` counts what the vault + selection hold ("2
 * keys set"), while the live label reports whether any of them is actually
 * enabled and delivered. A saved key that is not delivering therefore renders
 * as *saved but failing* — the two facts never overwrite each other.
 */
function ApiKeyStatusRow({ editor }: { editor: HarnessAuthEditorApi }) {
  const rows = editor.editorState.rows;
  const savedCount = rows.filter((row) => isRowComplete(row)).length;
  const enabledCount = rows.filter((row) => row.enabled && isRowComplete(row)).length;
  const savedButFailing = savedCount > 0 && enabledCount === 0;

  return (
    <HarnessStatusRow
      data-harness-status="api_key"
      label={enabledCount > 0
        ? HARNESS_PANE_COPY.apiKeyAuthenticated
        : savedButFailing
          ? HARNESS_PANE_COPY.apiKeySavedNotActive
          : HARNESS_PANE_COPY.apiKeyNotConfigured}
      tone={enabledCount > 0 ? "success" : savedButFailing ? "warning" : "neutral"}
      savedState={savedCount > 0 ? HARNESS_PANE_COPY.apiKeySaved(savedCount) : null}
      description={HARNESS_PANE_COPY.apiKeyRowHint}
      refreshing={editor.apiKeysQuery.isFetching || editor.selectionsQuery.isFetching}
      onRefresh={() => {
        void editor.apiKeysQuery.refetch();
        void editor.selectionsQuery.refetch();
      }}
    />
  );
}
