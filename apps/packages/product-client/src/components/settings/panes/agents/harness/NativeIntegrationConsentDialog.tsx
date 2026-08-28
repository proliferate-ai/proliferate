import type { NativeIntegrationRisk } from "@anyharness/sdk";
import { ConfirmationDialog } from "#product/primitives/patterns/ConfirmationDialog";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";

/**
 * The consent gate every native integration with non-None risk must pass
 * before its toggle takes effect (native-integrations.md, "Settings
 * surface"): the capability drives the user's real desktop or real browser,
 * so enabling it states three plain facts and waits for an explicit confirm.
 * The facts are risk-specific — desktop control names the vendor's per-app
 * macOS approvals, Esc as the stop, and the `cua_repl` server name; browser
 * control names the real Chrome it drives, the real signed-in browser
 * session its actions run in, and the `browser_repl` server name; the Claude
 * in Chrome bundle (`bundle:claude-chrome`) names its per-action approval and
 * the CLI's own `claude-in-chrome` server instead. Toggling OFF never routes
 * through here; revoking needs no ceremony.
 */
export function NativeIntegrationConsentDialog({
  open,
  integrationId,
  risk,
  integrationDisplayName,
  harnessDisplayName,
  loading = false,
  onClose,
  onConfirm,
}: {
  open: boolean;
  integrationId: string;
  risk: NativeIntegrationRisk;
  integrationDisplayName: string;
  harnessDisplayName: string;
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmationDialog
      open={open}
      title={HARNESS_PANE_COPY.nativeIntegrationsConsentTitle(
        integrationDisplayName,
        harnessDisplayName,
      )}
      description={consentBody(integrationId, risk, integrationDisplayName, harnessDisplayName)}
      confirmLabel={HARNESS_PANE_COPY.nativeIntegrationsConsentConfirm(integrationDisplayName)}
      loading={loading}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

function consentBody(
  integrationId: string,
  risk: NativeIntegrationRisk,
  integrationDisplayName: string,
  harnessDisplayName: string,
): string {
  if (integrationId === "bundle:claude-chrome") {
    return HARNESS_PANE_COPY.nativeIntegrationsConsentBodyClaudeChrome(integrationDisplayName);
  }
  if (risk === "browser_control") {
    return HARNESS_PANE_COPY.nativeIntegrationsConsentBodyBrowser(
      integrationDisplayName,
      harnessDisplayName,
    );
  }
  return HARNESS_PANE_COPY.nativeIntegrationsConsentBodyDesktop(integrationDisplayName);
}
