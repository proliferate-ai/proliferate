import type {
  ProductEntry,
  ProductEntryDestination,
  ProductLocationState,
  ProductQueryParams,
  ProductSettingsEntrySection,
} from "@proliferate/product-client/host/product-host";

/**
 * Location-state, query, and fragment primitives shared by the three public
 * seam functions in `./desktop-navigation` (decode, encode, route). They live
 * here so the seam module stays under the frontend size threshold; nothing
 * outside `desktop-navigation.ts` imports them.
 */

/**
 * Serialize `pathname` + destination `leading` params + the entry's leftover
 * location state into a route string. Leftover query pairs whose key is one of
 * `canonicalKeys` (the params the leading set authoritatively) are dropped so
 * the canonical value wins; everything else is appended in order with duplicates
 * intact. `canonicalKeys` defaults to every leading key.
 */
export function buildRoute(
  pathname: string,
  leading: ReadonlyArray<readonly [string, string]>,
  location: ProductLocationState,
  canonicalKeys: readonly string[] = leading.map(([key]) => key),
): string {
  const canonical = new Set(canonicalKeys);
  const params = new URLSearchParams();
  for (const [key, value] of leading) {
    // append, never set: duplicate leading keys are never produced, but append
    // keeps the codec uniform with the leftover pass below.
    params.append(key, value);
  }
  for (const [key, value] of location.query ?? []) {
    if (canonical.has(key)) {
      continue;
    }
    params.append(key, value);
  }
  const search = params.toString();
  return `${pathname}${search ? `?${search}` : ""}${fragmentSuffix(location)}`;
}

export function buildSettingsEntry(
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

export function buildIntegrationCallbackEntry(
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

export function settingsSectionForPath(pathname: string): ProductSettingsEntrySection | null {
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

export function settingsReturnUrlForSection(section: ProductSettingsEntrySection): string | null {
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
export function withLocation<D extends ProductEntryDestination>(
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
export function fragmentSuffix(entry: ProductLocationState): string {
  return entry.fragment ? `#${entry.fragment}` : "";
}

/** Every decoded query pair, in order, with duplicates preserved. */
export function searchToQuery(params: URLSearchParams): ProductQueryParams {
  return Array.from(params.entries());
}

/** Decoded query pairs, in order, minus the ones lifted into typed fields. */
export function collectQuery(
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

export function appendQuery(params: URLSearchParams, query?: ProductQueryParams): void {
  if (!query) {
    return;
  }
  for (const [key, value] of query) {
    // append, never set: duplicate keys (`x=1&x=2`) must survive round-trip.
    params.append(key, value);
  }
}

export function queryToParams(query?: ProductQueryParams): URLSearchParams {
  const params = new URLSearchParams();
  appendQuery(params, query);
  return params;
}

export function queryToSearch(query?: ProductQueryParams): string {
  const search = queryToParams(query).toString();
  return search ? `?${search}` : "";
}

export function decodeRoutePart(value: string): string {
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
export function parseJoinServerOrigin(raw: string | null): string | null {
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
