import type { IntegrationHealthItem } from "@proliferate/cloud-sdk/client/integrations";

/**
 * Connected integrations whose credentials stopped working and need the user
 * to re-authenticate. Only accounts that were actually connected qualify;
 * never-connected (`needs_auth`) or disabled integrations are not actionable
 * from the composer.
 */
export function integrationsNeedingReauth(
  items: readonly IntegrationHealthItem[],
): IntegrationHealthItem[] {
  return items.filter((item) => item.accountId !== null && item.health === "needs_reauth");
}

/**
 * Composer chip copy: "Linear needs re-authentication" for a single provider,
 * "N integrations need re-authentication" for several, null when healthy.
 */
export function integrationReauthChipLabel(displayNames: readonly string[]): string | null {
  if (displayNames.length === 0) {
    return null;
  }
  if (displayNames.length === 1) {
    return `${displayNames[0]} needs re-authentication`;
  }
  return `${displayNames.length} integrations need re-authentication`;
}
