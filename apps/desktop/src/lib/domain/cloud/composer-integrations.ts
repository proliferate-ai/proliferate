import type {
  IntegrationHealthItem,
  IntegrationHealthVerdict,
} from "@proliferate/cloud-sdk/client/integrations";
import {
  integrationReauthChipLabel,
  integrationsNeedingReauth,
} from "./integration-reauth";

/**
 * How the single composer integrations control presents itself, escalating
 * with the state of the user's connected integrations:
 * - `hidden`: no connected integrations, so the control is not rendered.
 * - `quiet`: every connected integration is healthy — a muted plug + count.
 * - `urgent`: one or more connected integrations need re-authentication, so
 *   the control adopts the reauth chip's warning presentation.
 */
export type ComposerIntegrationsMode = "hidden" | "quiet" | "urgent";

/** A connected provider as the composer popover lists it. */
export interface ComposerIntegrationProvider {
  definitionId: string;
  namespace: string;
  displayName: string;
  health: IntegrationHealthVerdict;
  /** Connected but credentials stopped working — offer a Reconnect affordance. */
  needsReauth: boolean;
}

export interface ComposerIntegrationsModel {
  mode: ComposerIntegrationsMode;
  /** Number of connected integrations (drives the quiet count). */
  connectedCount: number;
  /** Connected providers for the popover, reauth-needing ones sorted first. */
  providers: ComposerIntegrationProvider[];
  /**
   * Urgent copy identical to the old reauth chip:
   * "Linear needs re-authentication" / "N integrations need re-authentication";
   * null unless the control is in the `urgent` mode.
   */
  reauthLabel: string | null;
}

/** A connected integration is one with an actual account behind it. */
function isConnected(item: IntegrationHealthItem): boolean {
  return item.accountId !== null;
}

/**
 * Derive the composer integrations control model from live health items.
 *
 * Only connected accounts feed the control; never-connected catalog rows are
 * settings-pane concerns. The mode escalates to `urgent` the moment any
 * connected provider reports `needs_reauth`, reusing the exact reauth-chip
 * label so the urgent presentation matches the old chip.
 */
export function deriveComposerIntegrationsModel(
  items: readonly IntegrationHealthItem[],
): ComposerIntegrationsModel {
  const connected = items.filter(isConnected);
  const reauthDefinitionIds = new Set(
    integrationsNeedingReauth(items).map((item) => item.definitionId),
  );

  const providers = connected
    .map<ComposerIntegrationProvider>((item) => ({
      definitionId: item.definitionId,
      namespace: item.namespace,
      displayName: item.displayName,
      health: item.health,
      needsReauth: reauthDefinitionIds.has(item.definitionId),
    }))
    // Surface the providers that need attention first; keep the rest in the
    // health endpoint's order (a stable sort preserves it within each group).
    .sort((a, b) => Number(b.needsReauth) - Number(a.needsReauth));

  const reauthLabel = integrationReauthChipLabel(
    providers.filter((provider) => provider.needsReauth).map((provider) => provider.displayName),
  );

  const mode: ComposerIntegrationsMode =
    connected.length === 0 ? "hidden" : reauthLabel !== null ? "urgent" : "quiet";

  return {
    mode,
    connectedCount: connected.length,
    providers,
    reauthLabel: mode === "urgent" ? reauthLabel : null,
  };
}

export interface ComposerIntegrationHealthDot {
  /** Background utility for the status dot. */
  className: string;
  /** Screen-reader text describing the connection state. */
  label: string;
}

/** Status-dot presentation for a connected provider's health verdict. */
export function composerIntegrationHealthDot(
  health: IntegrationHealthVerdict,
): ComposerIntegrationHealthDot {
  switch (health) {
    case "ready":
      return { className: "bg-success", label: "Connected" };
    case "needs_reauth":
      return { className: "bg-warning", label: "Needs re-authentication" };
    case "error":
      return { className: "bg-destructive", label: "Error" };
    case "needs_auth":
      return { className: "bg-muted-foreground/50", label: "Not connected" };
    case "disabled_by_user":
      return { className: "bg-muted-foreground/50", label: "Disabled" };
    case "disabled_by_org":
      return { className: "bg-muted-foreground/50", label: "Disabled by organization" };
    default: {
      // Exhaustiveness guard: a new verdict must add a case above or this
      // fails to compile. Fall back to a neutral dot rather than throwing in
      // UI code.
      const _exhaustive: never = health;
      void _exhaustive;
      return { className: "bg-muted-foreground/50", label: "Unknown" };
    }
  }
}
