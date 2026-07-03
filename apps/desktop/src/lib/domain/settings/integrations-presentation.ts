import type { BadgeTone } from "@proliferate/ui/primitives/Badge";
import type {
  IntegrationAuthKind,
  IntegrationHealthVerdict,
} from "@proliferate/cloud-sdk/client/integrations";
import type { CloudIntegrationView } from "@/lib/domain/cloud/integrations";

/** Human label for how an integration authenticates. */
export function integrationAuthKindLabel(authKind: IntegrationAuthKind): string {
  switch (authKind) {
    case "oauth2":
      return "OAuth";
    case "api_key":
      return "API key";
    case "none":
      return "No auth";
  }
}

export interface IntegrationHealthBadge {
  label: string;
  tone: BadgeTone;
}

/** Badge presentation for a health verdict. */
export function integrationHealthBadge(health: IntegrationHealthVerdict): IntegrationHealthBadge {
  switch (health) {
    case "ready":
      return { label: "Ready", tone: "success" };
    case "needs_auth":
      return { label: "Not connected", tone: "neutral" };
    case "needs_reauth":
      return { label: "Reconnect required", tone: "warning" };
    case "disabled_by_user":
      return { label: "Disabled", tone: "neutral" };
    case "disabled_by_org":
      return { label: "Disabled by org", tone: "neutral" };
    case "error":
      return { label: "Error", tone: "destructive" };
  }
}

/** "3 tools" / "1 tool"; null when the gateway has not probed the integration. */
export function integrationToolCountLabel(toolCount: number | null): string | null {
  if (toolCount === null) {
    return null;
  }
  return toolCount === 1 ? "1 tool" : `${toolCount} tools`;
}

export interface IntegrationRowActions {
  /** First-time connect (also re-connect after a disconnect). */
  connect: boolean;
  /** Repair an existing account whose credentials stopped working. */
  reconnect: boolean;
  /** Remove the connected account. */
  disconnect: boolean;
}

/**
 * Which actions a row offers for its current state.
 *
 * Org-disabled rows are action-free except for disconnecting a leftover
 * account; connecting them again would only produce dead accounts.
 */
export function integrationRowActions(
  view: Pick<CloudIntegrationView, "accountId" | "health">,
): IntegrationRowActions {
  const hasAccount = view.accountId !== null;
  if (view.health === "disabled_by_org") {
    return { connect: false, reconnect: false, disconnect: hasAccount };
  }
  return {
    connect: !hasAccount || view.health === "needs_auth",
    reconnect: hasAccount && (view.health === "needs_reauth" || view.health === "error"),
    disconnect: hasAccount,
  };
}

export interface IntegrationOauthReturnToast {
  message: string;
  type: "info" | "error";
}

/** Below this row count the list is scannable without a filter input. */
export const INTEGRATIONS_SEARCH_THRESHOLD = 6;

export interface IntegrationSearchable {
  displayName: string;
  namespace: string;
}

/** Case-insensitive substring match against display name or namespace. */
export function integrationMatchesQuery(item: IntegrationSearchable, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return true;
  }
  return (
    item.displayName.toLocaleLowerCase().includes(normalized) ||
    item.namespace.toLocaleLowerCase().includes(normalized)
  );
}

/** Shared filter predicate for the user and org integrations panes. */
export function filterIntegrationsByQuery<T extends IntegrationSearchable>(
  items: readonly T[],
  query: string,
): T[] {
  if (!query.trim()) {
    return [...items];
  }
  return items.filter((item) => integrationMatchesQuery(item, query));
}

/**
 * Toast for an OAuth completion, used both by in-app flow polling and by the
 * browser deep-link return (`?status=...&failureCode=...`). Non-terminal or
 * missing statuses produce no toast.
 */
export function integrationOauthReturnToast(
  status: string | null | undefined,
  failureCode?: string | null,
): IntegrationOauthReturnToast | null {
  if (!status) {
    return null;
  }
  if (status === "completed") {
    return { message: "Integration connected.", type: "info" };
  }
  if (status === "failed" || status === "expired" || status === "cancelled") {
    const reason = failureCode ? ` (${failureCode})` : "";
    if (status === "cancelled") {
      return { message: "Integration authorization was cancelled.", type: "info" };
    }
    return {
      message: status === "expired"
        ? `Integration authorization expired${reason}. Try connecting again.`
        : `Integration could not be connected${reason}.`,
      type: "error",
    };
  }
  return null;
}
