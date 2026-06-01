import type {
  PluginConnectionDraft,
  PluginInventoryItem,
} from "@proliferate/product-domain/plugins/cloud-plugin-inventory";

export const OAUTH_RETURN_PATH = "/plugins/connect/complete";

export const OAUTH_TERMINAL_STATUSES = new Set(["completed", "expired", "cancelled", "failed"]);

export function firstErrorMessage(...errors: unknown[]): string | null {
  for (const error of errors) {
    if (error) {
      return errorMessage(error);
    }
  }
  return null;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Plugin action could not be completed.";
}

export function applyLocalOAuthStatuses(
  items: readonly PluginInventoryItem[],
  localOAuthStatuses: Record<string, "ready" | "not_ready">,
): PluginInventoryItem[] {
  return items.map((item) => {
    if (item.setupVariant !== "local_oauth" || localOAuthStatuses[item.id] !== "not_ready") {
      return item;
    }
    return {
      ...item,
      broken: true,
      statusLabel: "Needs reconnect",
      statusTone: "error",
      statusActionLabel: "Reconnect",
    };
  });
}

export function oauthFailureMessage(failureCode?: string | null): string {
  switch (failureCode) {
    case "access_denied":
      return "Authorization was cancelled.";
    case "expired":
      return "Authorization expired.";
    case "connection_deleted":
      return "The plugin connection was deleted before authorization finished.";
    case "superseded":
      return "A newer authorization attempt replaced this one.";
    default:
      return "OAuth authorization could not be completed.";
  }
}

export function hasAnySecretValue(draft: PluginConnectionDraft): boolean {
  return Object.values(draft.secretFields).some((value) => value.trim().length > 0);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
