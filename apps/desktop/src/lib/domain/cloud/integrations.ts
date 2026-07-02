import type {
  IntegrationAuthKind,
  IntegrationCatalogItem,
  IntegrationConnectSchema,
  IntegrationHealthItem,
  IntegrationHealthVerdict,
} from "@proliferate/cloud-sdk/client/integrations";

/**
 * One integration as the settings UI sees it: the connect-time catalog entry
 * (what fields the user must fill in) merged with the live health verdict
 * (what state their account is in), keyed by definitionId.
 */
export interface CloudIntegrationView {
  definitionId: string;
  namespace: string;
  displayName: string;
  description: string | null;
  authKind: IntegrationAuthKind;
  connectSchema: IntegrationConnectSchema;
  accountId: string | null;
  health: IntegrationHealthVerdict;
  effectiveEnabled: boolean;
  policyEnabled: boolean | null;
  accountEnabled: boolean | null;
  tokenExpiresAt: string | null;
  toolCount: number | null;
  lastErrorCode: string | null;
}

const EMPTY_CONNECT_SCHEMA: IntegrationConnectSchema = {
  secretFields: [],
  settingsFields: [],
};

/**
 * Merge catalog + health items by definitionId.
 *
 * The catalog drives ordering and connect metadata; health contributes the
 * account state. A definition present in only one source still yields a row:
 * catalog-only rows default to `needs_auth`, and health-only rows (e.g. the
 * two endpoints raced across a definition change) fall back to the health
 * item's own display metadata with an empty connect schema.
 */
export function mergeCloudIntegrations(
  catalogItems: readonly IntegrationCatalogItem[],
  healthItems: readonly IntegrationHealthItem[],
): CloudIntegrationView[] {
  const healthById = new Map(healthItems.map((item) => [item.definitionId, item]));
  const views: CloudIntegrationView[] = [];

  for (const item of catalogItems) {
    const health = healthById.get(item.definitionId);
    healthById.delete(item.definitionId);
    views.push({
      definitionId: item.definitionId,
      namespace: item.namespace,
      displayName: item.displayName,
      description: item.description,
      authKind: item.authKind,
      connectSchema: item.connectSchema,
      accountId: health?.accountId ?? null,
      health: health?.health ?? "needs_auth",
      effectiveEnabled: health?.effectiveEnabled ?? true,
      policyEnabled: health?.policyEnabled ?? null,
      accountEnabled: health?.accountEnabled ?? null,
      tokenExpiresAt: health?.tokenExpiresAt ?? null,
      toolCount: health?.toolCount ?? null,
      lastErrorCode: health?.lastErrorCode ?? null,
    });
  }

  for (const health of healthById.values()) {
    views.push({
      definitionId: health.definitionId,
      namespace: health.namespace,
      displayName: health.displayName,
      description: null,
      authKind: health.authKind,
      connectSchema: EMPTY_CONNECT_SCHEMA,
      accountId: health.accountId,
      health: health.health,
      effectiveEnabled: health.effectiveEnabled,
      policyEnabled: health.policyEnabled,
      accountEnabled: health.accountEnabled,
      tokenExpiresAt: health.tokenExpiresAt,
      toolCount: health.toolCount,
      lastErrorCode: health.lastErrorCode,
    });
  }

  return views;
}

const TERMINAL_OAUTH_FLOW_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "expired",
]);

/** Whether an integration OAuth flow has reached a state that stops polling. */
export function isTerminalIntegrationOauthFlowStatus(status: string): boolean {
  return TERMINAL_OAUTH_FLOW_STATUSES.has(status);
}
