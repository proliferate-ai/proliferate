import type {
  ProductEntry,
  ProductLocationState,
  ProductQueryParams,
  ProductSettingsEntrySection,
} from "@proliferate/product-client/host/product-host";

/**
 * Decode a raw Desktop deep-link URL into the shared {@link ProductEntry}
 * normalization. Malformed, auth-callback, and unknown inbound URLs decode to
 * `null`; auth callbacks stay exclusively in the Desktop auth transport.
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

  if (host === "" && (pathname === "" || pathname === "/")) {
    return withLocation({ kind: "home" }, parsed);
  }

  if (host === "join") {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length !== 1) {
      return null;
    }

    const organizationId = decodeRoutePart(segments[0]);
    // The issuing server stamps its own origin so a self-hosted invite can
    // point the desktop at the right server. Validate hard and DROP anything
    // untrusted — a dropped origin degrades to today's behavior, never a
    // silent server switch.
    const serverOrigin = parseJoinServerOrigin(parsed.searchParams.get("origin"));
    return withLocation(
      serverOrigin
        ? { kind: "organization-join", organizationId, serverOrigin }
        : { kind: "organization-join", organizationId },
      parsed,
      (key) => key !== "origin",
    );
  }

  if (host === "workspaces") {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 1) {
      return withLocation(
        {
          kind: "workspace",
          workspaceId: decodeRoutePart(segments[0]),
        },
        parsed,
      );
    }
    return null;
  }

  if (host === "billing" && (pathname === "/success" || pathname === "/cancel")) {
    return withLocation(
      {
        kind: "billing-return",
        status: pathname === "/success" ? "success" : "cancel",
      },
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
 * Encode a normalized {@link ProductEntry} as a Desktop deep link. Only
 * destinations with an existing Desktop transport URL are accepted.
 */
export function encodeDesktopReturnUrl(entry: ProductEntry): string {
  switch (entry.kind) {
    case "home":
      return `proliferate://${locationSuffix(entry)}`;
    case "workspace":
      return `proliferate://workspaces/${encodeURIComponent(entry.workspaceId)}${locationSuffix(entry)}`;
    case "organization-join": {
      const params = queryToParams(entry.query);
      params.delete("origin");
      if (entry.serverOrigin) {
        params.append("origin", entry.serverOrigin);
      }
      return `proliferate://join/${encodeURIComponent(entry.organizationId)}${paramsAndFragmentSuffix(params, entry.fragment)}`;
    }
    case "billing-return": {
      if (entry.status !== "success" && entry.status !== "cancel") {
        throw new Error(
          `No Desktop return URL for billing-return status: ${entry.status}`,
        );
      }
      return `proliferate://billing/${entry.status}${locationSuffix(entry)}`;
    }
    case "integration-callback": {
      const params = queryToParams(entry.query);
      ensureTypedParam(params, "source", entry.source);
      ensureTypedParam(params, "status", entry.status ?? null);
      ensureTypedParam(params, "flowId", entry.flowId ?? null);
      ensureTypedParam(params, "failureCode", entry.failureCode ?? null);
      return `proliferate://integrations${paramsAndFragmentSuffix(params, entry.fragment)}`;
    }
    case "settings": {
      const base = settingsReturnUrlForSection(entry.section);
      if (base === null) {
        throw new Error(`No Desktop return URL for settings section: ${entry.section}`);
      }
      const params = queryToParams(entry.query);
      if (entry.source) {
        ensureTypedParam(params, "source", entry.source);
      }
      return `${base}${paramsAndFragmentSuffix(params, entry.fragment)}`;
    }
    default:
      throw new Error(`No Desktop return URL for entry kind: ${(entry as ProductEntry).kind}`);
  }
}

function buildSettingsEntry(
  section: ProductSettingsEntrySection,
  parsed: URL,
): ProductEntry {
  const source = parsed.searchParams.get("source");
  const typedSource = source === "github_app_callback" ? source : undefined;
  return withLocation(
    typedSource
      ? { kind: "settings", section, source: typedSource }
      : { kind: "settings", section },
    parsed,
  );
}

function buildIntegrationCallbackEntry(
  source: "integration_oauth_callback" | "mcp_oauth_callback",
  parsed: URL,
): ProductEntry {
  const entry: Extract<ProductEntry, { kind: "integration-callback" }> = {
    kind: "integration-callback",
    source,
  };
  const status = parsed.searchParams.get("status");
  if (status === "completed" || status === "failed") {
    entry.status = status;
  }
  const flowId = parsed.searchParams.get("flowId");
  if (flowId) {
    entry.flowId = flowId;
  }
  const failureCode = parsed.searchParams.get("failureCode");
  if (failureCode) {
    entry.failureCode = failureCode;
  }
  return withLocation(entry, parsed);
}

function withLocation(
  destination: ProductEntry,
  parsed: URL,
  includeQueryPair?: (key: string, value: string) => boolean,
): ProductEntry {
  const query = searchToQuery(parsed.searchParams, includeQueryPair);
  const fragment = decodeFragment(parsed.hash);
  return {
    ...destination,
    ...(query ? { query } : {}),
    ...(fragment ? { fragment } : {}),
  };
}

function ensureTypedParam(
  params: URLSearchParams,
  key: string,
  value: string | null,
): void {
  if (value === null) {
    return;
  }
  const current = params.get(key);
  if (current === null) {
    params.append(key, value);
    return;
  }
  if (current !== value) {
    params.set(key, value);
  }
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

function searchToQuery(
  params: URLSearchParams,
  includePair: (key: string, value: string) => boolean = () => true,
): ProductQueryParams | undefined {
  const query = Array.from(params.entries()).filter(([key, value]) =>
    includePair(key, value),
  );
  return query.length > 0 ? query : undefined;
}

function queryToParams(query?: ProductQueryParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of query ?? []) {
    params.append(key, value);
  }
  return params;
}

function locationSuffix(location: ProductLocationState): string {
  return paramsAndFragmentSuffix(queryToParams(location.query), location.fragment);
}

function paramsAndFragmentSuffix(
  params: URLSearchParams,
  fragment?: string,
): string {
  const search = params.toString();
  const hash = fragment ? `#${encodeURIComponent(fragment)}` : "";
  return `${search ? `?${search}` : ""}${hash}`;
}

function decodeFragment(hash: string): string | undefined {
  if (!hash) {
    return undefined;
  }
  return decodeRoutePart(hash.slice(1)) || undefined;
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
 * Returns a normalized safe origin or null so untrusted input is dropped.
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

  if (parsed.username || parsed.password || !parsed.hostname) {
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
