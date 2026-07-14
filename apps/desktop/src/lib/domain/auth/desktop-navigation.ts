import type {
  ProductEntry,
  ProductEntryDestination,
  ProductLocationState,
  ProductQueryParams,
  ProductSettingsEntrySection,
} from "@proliferate/product-client/host/product-host";

// Legacy in-app route mapping for `proliferate://settings/<path>` deep links.
// Excludes `/environments` (no nav route) to stay byte-identical to the branches.
const NAV_SETTINGS_SECTION_BY_PATH: Record<string, ProductSettingsEntrySection> = {
  "/cloud": "billing",
  "/billing": "billing",
  "/account": "account",
  "/organization": "organization",
  "/slack-bot": "general",
};

/**
 * Decode a raw Desktop deep-link URL into the shared {@link ProductEntry}
 * normalization. This is the inverse of {@link encodeDesktopReturnUrl} for the
 * destinations that round-trip. It recognizes exactly the URLs the legacy
 * `desktopNavigationTarget` table supported plus the literal return URLs the
 * codebase emits (github-app callbacks landing on account/organization/
 * environments). Malformed, auth-callback, and unknown inbound URLs decode to
 * `null`; the decoder never invents a destination.
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
 * Existing-consumer adapter: the legacy in-app route string for a raw deep
 * link, byte-identical to the historical route table (including exotic query
 * semantics: percent-encoded spaces, duplicate keys, unrecognized params).
 *
 * Intentionally does NOT route through {@link decodeDesktopProductEntry}: the
 * normalized {@link ProductEntry} codec collapses queries into a lossy
 * `Record<string, string>` (`x=a%20b`→`x=a+b`, `x=1&x=2`→`x=2`, unknown params
 * drop), so query-carrying routes are rebuilt from the raw `URL.search`.
 */
export function desktopNavigationTarget(url: string): string | null {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "proliferate:" && parsed.protocol !== "proliferate-local:") {
    return null;
  }

  if (parsed.hostname === "join") {
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length === 1) {
      const organizationId = decodeRoutePart(segments[0]);
      // Lands on Account (every signed-in user can reach it), not the
      // admin-gated Members pane — a non-admin invitee must be able to
      // follow this link and see/accept their invitation.
      const params = new URLSearchParams({ section: "account" });
      params.set("joinOrganizationId", organizationId);
      // The issuing server stamps its own origin so a self-hosted invite points
      // the desktop at the right server. Any web page can fire this deep link
      // with an attacker-supplied origin, so validate hard and DROP anything
      // untrusted — a dropped origin degrades to today's behavior, never a
      // silent server switch.
      const joinServerOrigin = parseJoinServerOrigin(parsed.searchParams.get("origin"));
      if (joinServerOrigin) {
        params.set("joinServerOrigin", joinServerOrigin);
      }
      return `/settings?${params.toString()}`;
    }
  }

  if (parsed.hostname === "settings") {
    // Legacy settings deep links map their path to a settings section.
    // SLACK BOT PARKED: /slack-bot lands on General while disabled.
    const settingsSection = NAV_SETTINGS_SECTION_BY_PATH[parsed.pathname];
    if (settingsSection) {
      const params = new URLSearchParams(parsed.search);
      params.set("section", settingsSection);
      return `/settings?${params.toString()}`;
    }
  }

  if (
    parsed.hostname === "billing"
    && (parsed.pathname === "/success" || parsed.pathname === "/cancel")
  ) {
    const params = new URLSearchParams(parsed.search);
    params.set("checkout", parsed.pathname === "/success" ? "success" : "cancel");
    params.set("section", "billing");
    return `/settings?${params.toString()}`;
  }

  if (
    (parsed.hostname === "integrations" || parsed.hostname === "plugins" || parsed.hostname === "powers")
    && (parsed.pathname === "" || parsed.pathname === "/")
  ) {
    // Integration OAuth browser returns (and legacy plugins/powers links) land on
    // the user Integrations pane, carrying flowId/status/failureCode so the pane
    // can toast the flow outcome on arrival.
    const params = new URLSearchParams(parsed.search);
    params.set("section", "integrations");
    return `/settings?${params.toString()}`;
  }

  if (parsed.hostname === "workspaces") {
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length === 1) {
      return `/workspaces/${encodeURIComponent(decodeRoutePart(segments[0]))}${parsed.search}`;
    }
  }

  return null;
}

function buildSettingsEntry(
  section: ProductSettingsEntrySection,
  parsed: URL,
): ProductEntry {
  // ProductEntry.settings.source is typed only "github_app_callback"; other
  // source values (e.g. github_app_installation_callback) stay in query.
  const rawSource = parsed.searchParams.get("source");
  const source: "github_app_callback" | undefined =
    rawSource === "github_app_callback" ? rawSource : undefined;
  const query = collectQuery(
    parsed.searchParams,
    (key, value) => key === "source" && value === "github_app_callback",
  );
  const destination: Extract<ProductEntryDestination, { kind: "settings" }> = source
    ? { kind: "settings", section, source }
    : { kind: "settings", section };
  return withLocation(destination, query, parsed);
}

function buildIntegrationCallbackEntry(
  source: "integration_oauth_callback" | "mcp_oauth_callback",
  parsed: URL,
): ProductEntry {
  const params = parsed.searchParams;
  const destination: Extract<ProductEntryDestination, { kind: "integration-callback" }> = {
    kind: "integration-callback",
    source,
  };
  const rawStatus = params.get("status");
  const status: "completed" | "failed" | undefined =
    rawStatus === "completed" || rawStatus === "failed" ? rawStatus : undefined;
  if (status) {
    destination.status = status;
  }
  const flowId = params.get("flowId");
  if (flowId) {
    destination.flowId = flowId;
  }
  const failureCode = params.get("failureCode");
  if (failureCode) {
    destination.failureCode = failureCode;
  }
  // Lift only the values we recognized into typed fields; everything else
  // (unknown params, an unrecognized `status`, duplicates) survives in query.
  const query = collectQuery(params, (key, value) => {
    if (key === "source" && value === source) return true;
    if (key === "status" && status !== undefined && value === status) return true;
    if (key === "flowId" && flowId !== null && value === flowId) return true;
    if (key === "failureCode" && failureCode !== null && value === failureCode) return true;
    return false;
  });
  return withLocation(destination, query, parsed);
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

/**
 * Compose a destination with lossless {@link ProductLocationState}. Empty query
 * and absent fragment are omitted rather than stored as empty values.
 */
function withLocation<D extends ProductEntryDestination>(
  destination: D,
  query: ProductQueryParams,
  parsed: URL,
): D & ProductLocationState {
  const location: ProductLocationState = {};
  if (query.length > 0) {
    location.query = query;
  }
  const fragment = fragmentOf(parsed);
  if (fragment !== undefined) {
    location.fragment = fragment;
  }
  return { ...destination, ...location };
}

/** The decoded fragment (without `#`), or undefined when there is none. */
function fragmentOf(parsed: URL): string | undefined {
  if (!parsed.hash) {
    return undefined;
  }
  const raw = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  if (raw.length === 0) {
    return undefined;
  }
  return decodeRoutePart(raw);
}

/** Append exactly one `#fragment` when the entry carries one. */
function fragmentSuffix(entry: ProductLocationState): string {
  return entry.fragment ? `#${entry.fragment}` : "";
}

/** Every decoded query pair, in order, with duplicates preserved. */
function searchToQuery(params: URLSearchParams): ProductQueryParams {
  return Array.from(params.entries());
}

/** Decoded query pairs, in order, minus the ones lifted into typed fields. */
function collectQuery(
  params: URLSearchParams,
  isConsumed: (key: string, value: string) => boolean,
): ProductQueryParams {
  const pairs: Array<readonly [string, string]> = [];
  for (const [key, value] of params) {
    if (isConsumed(key, value)) {
      continue;
    }
    pairs.push([key, value] as const);
  }
  return pairs;
}

function appendQuery(params: URLSearchParams, query?: ProductQueryParams): void {
  if (!query) {
    return;
  }
  for (const [key, value] of query) {
    // append, never set: duplicate keys (`x=1&x=2`) must survive round-trip.
    params.append(key, value);
  }
}

function queryToParams(query?: ProductQueryParams): URLSearchParams {
  const params = new URLSearchParams();
  appendQuery(params, query);
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
