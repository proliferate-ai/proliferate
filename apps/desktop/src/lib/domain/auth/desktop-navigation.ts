import type {
  ProductEntry,
  ProductQueryParams,
  ProductSettingsEntrySection,
} from "@proliferate/product-client/host/product-host";

/**
 * Decode a raw Desktop deep-link URL into the shared {@link ProductEntry}
 * normalization. This is the inverse of {@link encodeDesktopReturnUrl} for the
 * destinations that round-trip. It recognizes exactly the URLs the legacy
 * `desktopNavigationTarget` table supported plus the literal return URLs the
 * codebase emits (github-app callbacks landing on account/organization/
 * environments). Malformed, auth-callback, and unknown inbound URLs decode to
 * `null`; the decoder never invents a destination.
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
      return serverOrigin
        ? { kind: "organization-join", organizationId, serverOrigin }
        : { kind: "organization-join", organizationId };
    }
    return null;
  }

  if (host === "workspaces") {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 1) {
      return {
        kind: "workspace",
        workspaceId: decodeRoutePart(segments[0]),
        query: searchToQuery(parsed.searchParams),
      };
    }
    return null;
  }

  if (host === "billing" && (pathname === "/success" || pathname === "/cancel")) {
    return {
      kind: "billing-return",
      status: pathname === "/success" ? "success" : "cancel",
      query: searchToQuery(parsed.searchParams),
    };
  }

  if (
    (host === "integrations" || host === "plugins" || host === "powers")
    && (pathname === "" || pathname === "/")
  ) {
    const source = parsed.searchParams.get("source");
    if (source === "integration_oauth_callback" || source === "mcp_oauth_callback") {
      return buildIntegrationCallbackEntry(source, parsed.searchParams);
    }
    return buildSettingsEntry("integrations", parsed.searchParams);
  }

  if (host === "settings") {
    const section = settingsSectionForPath(pathname);
    if (section) {
      return buildSettingsEntry(section, parsed.searchParams);
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
 * entry.
 */
export function encodeDesktopReturnUrl(entry: ProductEntry): string {
  switch (entry.kind) {
    case "workspace":
      return `proliferate://workspaces/${encodeURIComponent(entry.workspaceId)}${queryToSearch(entry.query)}`;
    case "organization-join": {
      const base = `proliferate://join/${encodeURIComponent(entry.organizationId)}`;
      if (entry.serverOrigin) {
        const params = new URLSearchParams({ origin: entry.serverOrigin });
        return `${base}?${params.toString()}`;
      }
      return base;
    }
    case "billing-return": {
      if (entry.status !== "success" && entry.status !== "cancel") {
        throw new Error(
          `No Desktop return URL for billing-return status: ${entry.status}`,
        );
      }
      return `proliferate://billing/${entry.status}${queryToSearch(entry.query)}`;
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
      return `proliferate://integrations?${params.toString()}`;
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
      return search ? `${base}?${search}` : base;
    }
    default:
      throw new Error(`No Desktop return URL for entry kind: ${(entry as ProductEntry).kind}`);
  }
}

/**
 * Existing-consumer adapter: the legacy in-app route string for a raw deep
 * link, derived from {@link decodeDesktopProductEntry}. Returns byte-identical
 * strings to the historical route table for every URL that table supported.
 * URLs the table never routed (including the newly decodable `environments`
 * return URL) stay `null`.
 */
export function desktopNavigationTarget(url: string): string | null {
  const entry = decodeDesktopProductEntry(url);
  if (entry === null) {
    return null;
  }
  return entryToRoute(entry);
}

function entryToRoute(entry: ProductEntry): string | null {
  switch (entry.kind) {
    case "organization-join": {
      // Lands on Account (every signed-in user can reach it), not the
      // admin-gated Members pane — a non-admin invitee must be able to follow
      // this link and see/accept their invitation.
      const params = new URLSearchParams({ section: "account" });
      params.set("joinOrganizationId", entry.organizationId);
      if (entry.serverOrigin) {
        params.set("joinServerOrigin", entry.serverOrigin);
      }
      return `/settings?${params.toString()}`;
    }
    case "workspace":
      return `/workspaces/${encodeURIComponent(entry.workspaceId)}${queryToSearch(entry.query)}`;
    case "billing-return": {
      const params = queryToParams(entry.query);
      params.set("checkout", entry.status);
      params.set("section", "billing");
      return `/settings?${params.toString()}`;
    }
    case "integration-callback": {
      // Integration OAuth browser returns (and legacy plugins/powers links)
      // land on the user Integrations pane, carrying flowId/status/failureCode
      // so the pane can toast the flow outcome on arrival.
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
      params.set("section", "integrations");
      return `/settings?${params.toString()}`;
    }
    case "settings": {
      // The legacy navigation table never routed "environments"; keep it null
      // so desktopNavigationTarget stays byte-identical while decode still
      // recognizes environments return URLs for the ProductLinks path.
      if (entry.section === "environments") {
        return null;
      }
      const params = queryToParams(entry.query);
      if (entry.source) {
        params.set("source", entry.source);
      }
      params.set("section", entry.section);
      return `/settings?${params.toString()}`;
    }
    default:
      return null;
  }
}

function buildSettingsEntry(
  section: ProductSettingsEntrySection,
  params: URLSearchParams,
): ProductEntry {
  const query: Record<string, string> = {};
  let source: "github_app_callback" | undefined;
  for (const [key, value] of params) {
    // ProductEntry.settings.source is typed only "github_app_callback"; other
    // source values (e.g. github_app_installation_callback) stay in query.
    if (key === "source" && value === "github_app_callback" && source === undefined) {
      source = value;
      continue;
    }
    query[key] = value;
  }
  return source
    ? { kind: "settings", section, source, query }
    : { kind: "settings", section, query };
}

function buildIntegrationCallbackEntry(
  source: "integration_oauth_callback" | "mcp_oauth_callback",
  params: URLSearchParams,
): ProductEntry {
  const entry: Extract<ProductEntry, { kind: "integration-callback" }> = {
    kind: "integration-callback",
    source,
  };
  const status = params.get("status");
  if (status === "completed" || status === "failed") {
    entry.status = status;
  }
  const flowId = params.get("flowId");
  if (flowId) {
    entry.flowId = flowId;
  }
  const failureCode = params.get("failureCode");
  if (failureCode) {
    entry.failureCode = failureCode;
  }
  return entry;
}

function settingsSectionForPath(pathname: string): ProductSettingsEntrySection | null {
  switch (pathname) {
    case "/cloud":
    case "/billing":
      return "billing";
    case "/account":
      return "account";
    case "/organization":
      return "organization";
    case "/environments":
      return "environments";
    // SLACK BOT PARKED: legacy Slack settings links land on General while disabled.
    case "/slack-bot":
      return "general";
    default:
      return null;
  }
}

function settingsReturnUrlForSection(section: ProductSettingsEntrySection): string | null {
  switch (section) {
    case "account":
      return "proliferate://settings/account";
    case "organization":
      return "proliferate://settings/organization";
    case "environments":
      return "proliferate://settings/environments";
    case "billing":
      return "proliferate://settings/billing";
    case "integrations":
      return "proliferate://integrations";
    // "general" is the parked slack-bot landing; it has no current return URL.
    case "general":
      return null;
  }
}

function searchToQuery(params: URLSearchParams): ProductQueryParams {
  const query: Record<string, string> = {};
  for (const [key, value] of params) {
    query[key] = value;
  }
  return query;
}

function queryToParams(query?: ProductQueryParams): URLSearchParams {
  const params = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      params.set(key, value);
    }
  }
  return params;
}

function queryToSearch(query?: ProductQueryParams): string {
  const search = queryToParams(query).toString();
  return search ? `?${search}` : "";
}

function decodeRoutePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Validate the `origin` embedded in a `proliferate://join/<id>` deep link.
 * This is the parser-side half of the trust boundary: the desktop must never
 * treat an unvalidated origin as a server address. Returns the normalized
 * origin (scheme + host, no trailing slash) only when it is:
 * - a well-formed absolute URL,
 * - https (http tolerated solely for loopback dev servers),
 * - free of embedded credentials (no `user:pass@` phishing vector).
 * Anything else returns null so the caller drops the param.
 */
function parseJoinServerOrigin(raw: string | null): string | null {
  if (!raw) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.username || parsed.password) {
    return null;
  }

  if (!parsed.hostname) {
    return null;
  }

  if (parsed.protocol === "https:") {
    return parsed.origin;
  }

  if (parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname)) {
    return parsed.origin;
  }

  return null;
}
