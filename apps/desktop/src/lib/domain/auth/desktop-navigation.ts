import type { ProductEntry } from "@proliferate/product-client/host/product-host";

import {
  appendQuery,
  buildIntegrationCallbackEntry,
  buildRoute,
  buildSettingsEntry,
  collectQuery,
  decodeRoutePart,
  fragmentSuffix,
  parseJoinServerOrigin,
  queryToParams,
  queryToSearch,
  searchToQuery,
  settingsReturnUrlForSection,
  settingsSectionForPath,
  withLocation,
} from "@/lib/domain/auth/desktop-navigation-codec";

/**
 * Decode a raw Desktop deep-link URL into the shared {@link ProductEntry}
 * normalization. This is the inverse of {@link encodeDesktopReturnUrl} for the
 * destinations that round-trip and the single decoder feeding inbound routing
 * ({@link productEntryRoute}). It recognizes every navigation destination the
 * app supports plus the literal return URLs the codebase emits (github-app
 * callbacks landing on account/organization/environments). Malformed,
 * auth-callback, and unknown inbound URLs decode to `null`; the decoder never
 * invents a destination.
 *
 * Query parameters and the fragment are preserved losslessly as
 * {@link ProductLocationState}: ordered, duplicate-preserving pairs plus the
 * fragment (stored without its leading `#`). Params that define the destination
 * (the join `origin`, the settings/integration `source`, and the recognized
 * integration `status`/`flowId`/`failureCode`) are lifted into typed fields and
 * removed from the query bag; every other pair survives in order.
 */
export function decodeDesktopProductEntry(url: string): ProductEntry | null {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "proliferate:" && parsed.protocol !== "proliferate-local:") {
    return null;
  }

  const host = parsed.hostname;
  const pathname = parsed.pathname;

  if (host === "join") {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 1) {
      const organizationId = decodeRoutePart(segments[0]);
      // The issuing server stamps its own origin so a self-hosted invite can
      // point the desktop at the right server. Validate hard and DROP anything
      // untrusted — a dropped origin degrades to today's behavior, never a
      // silent server switch.
      const serverOrigin = parseJoinServerOrigin(parsed.searchParams.get("origin"));
      const query = collectQuery(parsed.searchParams, (key) => key === "origin");
      return serverOrigin
        ? withLocation({ kind: "organization-join", organizationId, serverOrigin }, query, parsed)
        : withLocation({ kind: "organization-join", organizationId }, query, parsed);
    }
    return null;
  }

  if (host === "workspaces") {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 1) {
      return withLocation(
        { kind: "workspace", workspaceId: decodeRoutePart(segments[0]) },
        searchToQuery(parsed.searchParams),
        parsed,
      );
    }
    return null;
  }

  if (host === "billing" && (pathname === "/success" || pathname === "/cancel")) {
    return withLocation(
      { kind: "billing-return", status: pathname === "/success" ? "success" : "cancel" },
      searchToQuery(parsed.searchParams),
      parsed,
    );
  }

  if (
    (host === "integrations" || host === "plugins" || host === "powers")
    && (pathname === "" || pathname === "/")
  ) {
    const source = parsed.searchParams.get("source");
    if (source === "integration_oauth_callback" || source === "mcp_oauth_callback") {
      return buildIntegrationCallbackEntry(source, parsed);
    }
    return buildSettingsEntry("integrations", parsed);
  }

  if (host === "settings") {
    const section = settingsSectionForPath(pathname);
    if (section) {
      return buildSettingsEntry(section, parsed);
    }
  }

  return null;
}

/**
 * Encode a normalized {@link ProductEntry} as the Desktop deep link the app
 * hands to Cloud mutations as a return URL. Only entry kinds/sections that have
 * a current Desktop URL are supported; everything else (workflow, invitation,
 * the parked `general` settings section, and non-round-tripping billing
 * statuses) throws, because D1a does not invent a route for an unsupported
 * entry. Query pairs are appended in order (duplicates preserved) and the
 * fragment, when present, is appended with exactly one `#`.
 */
export function encodeDesktopReturnUrl(entry: ProductEntry): string {
  switch (entry.kind) {
    case "workspace":
      return `proliferate://workspaces/${encodeURIComponent(entry.workspaceId)}${queryToSearch(entry.query)}${fragmentSuffix(entry)}`;
    case "organization-join": {
      const params = queryToParams(entry.query);
      if (entry.serverOrigin) {
        params.set("origin", entry.serverOrigin);
      }
      const search = params.toString();
      const base = `proliferate://join/${encodeURIComponent(entry.organizationId)}`;
      return `${base}${search ? `?${search}` : ""}${fragmentSuffix(entry)}`;
    }
    case "billing-return": {
      if (entry.status !== "success" && entry.status !== "cancel") {
        throw new Error(
          `No Desktop return URL for billing-return status: ${entry.status}`,
        );
      }
      return `proliferate://billing/${entry.status}${queryToSearch(entry.query)}${fragmentSuffix(entry)}`;
    }
    case "integration-callback": {
      const params = new URLSearchParams();
      params.set("source", entry.source);
      if (entry.status) {
        params.set("status", entry.status);
      }
      if (entry.flowId) {
        params.set("flowId", entry.flowId);
      }
      if (entry.failureCode) {
        params.set("failureCode", entry.failureCode);
      }
      appendQuery(params, entry.query);
      return `proliferate://integrations?${params.toString()}${fragmentSuffix(entry)}`;
    }
    case "settings": {
      const base = settingsReturnUrlForSection(entry.section);
      if (base === null) {
        throw new Error(`No Desktop return URL for settings section: ${entry.section}`);
      }
      const params = queryToParams(entry.query);
      if (entry.source) {
        params.set("source", entry.source);
      }
      const search = params.toString();
      return `${base}${search ? `?${search}` : ""}${fragmentSuffix(entry)}`;
    }
    default:
      throw new Error(`No Desktop return URL for entry kind: ${(entry as ProductEntry).kind}`);
  }
}

/**
 * Map a normalized {@link ProductEntry} to the in-app route the shared router
 * navigates to. This is the single inbound-navigation seam: every deep link is
 * decoded once by {@link decodeDesktopProductEntry} and mapped here. Auth
 * callbacks are consumed by the auth transport and never become a ProductEntry,
 * so they never reach this function.
 *
 * Each destination reproduces the route the legacy navigation table produced.
 * Location state is preserved losslessly: the entry's query pairs are appended
 * in order (duplicates kept) after the destination's own params, and the
 * fragment is appended with exactly one `#`. Destination params the legacy
 * table set canonically (`section`, `checkout`, `joinOrganizationId`,
 * `joinServerOrigin`) win over any same-named leftover pair; every other pair —
 * including duplicates and an unrecognized integration `status` — survives in
 * order. Param order among distinct keys is not behaviorally significant: the
 * settings/billing/integrations panes read by key name. The OAuth `source`
 * discriminator the decoder lifts (`github_app_callback`, the integration
 * callback source) is not re-emitted: no route consumer reads `source`, so it
 * is inert in the internal route.
 */
export function productEntryRoute(entry: ProductEntry): string {
  switch (entry.kind) {
    case "workspace":
      return buildRoute(`/workspaces/${encodeURIComponent(entry.workspaceId)}`, [], entry);
    case "workflow":
      return buildRoute(`/workflows/${encodeURIComponent(entry.workflowId)}`, [], entry);
    case "invitation":
      // No Desktop invitation route exists; land on Account settings — the
      // shared surface where an invitee reviews and accepts an invitation.
      return buildRoute("/settings", [["section", "account"]], entry);
    case "organization-join": {
      // Account (reachable by non-admins), not the admin-gated Members pane.
      const leading: Array<[string, string]> = [
        ["section", "account"],
        ["joinOrganizationId", entry.organizationId],
      ];
      if (entry.serverOrigin) {
        leading.push(["joinServerOrigin", entry.serverOrigin]);
      }
      return buildRoute("/settings", leading, entry);
    }
    case "billing-return":
      return buildRoute(
        "/settings",
        [["checkout", entry.status], ["section", "billing"]],
        entry,
      );
    case "integration-callback": {
      // Reconstruct the outcome fields the decoder lifted so the Integrations
      // pane sees the same flowId/status/failureCode it did before decode. Only
      // `section` is canonical here: a leftover (unrecognized) `status`/`flowId`
      // duplicate must survive, so it is not filtered.
      const leading: Array<[string, string]> = [["section", "integrations"]];
      if (entry.status) {
        leading.push(["status", entry.status]);
      }
      if (entry.flowId) {
        leading.push(["flowId", entry.flowId]);
      }
      if (entry.failureCode) {
        leading.push(["failureCode", entry.failureCode]);
      }
      return buildRoute("/settings", leading, entry, ["section"]);
    }
    case "settings":
      return buildRoute("/settings", [["section", entry.section]], entry, ["section"]);
  }
}
