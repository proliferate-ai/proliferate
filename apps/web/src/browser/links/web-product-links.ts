import type {
  ProductEntry,
  ProductLinks,
  ProductSettingsEntrySection,
} from "@proliferate/product-client/host/product-host";
import {
  buildIntegrationCallbackEntry,
  buildSettingsEntry,
  collectQuery,
  fragmentSuffix,
  queryToParams,
  withLocation,
} from "@proliferate/product-client/internal/lib/domain/auth/desktop-navigation-codec";

/**
 * The Web `host.links` adapter. It owns only browser transport:
 *
 * - `openExternal` opens a URL in a new browser tab.
 * - `buildReturnUrl` encodes a normalized {@link ProductEntry} as the HTTPS
 *   callback URL handed to Cloud mutations (the Web analogue of Desktop's
 *   `proliferate://` deep link).
 * - `observeInboundEntries` is the delivery channel for the host callback/return
 *   decoders. Web's analogue of Desktop's launch deep link is the cold-load
 *   browser return: the host entry routes decode it and call
 *   {@link emitWebInboundEntry} during bootstrap, before the lazily loaded
 *   ProductClient subscribes. Mirroring Desktop's per-subscriber
 *   initial-snapshot semantics, the single entry decoded for the current
 *   document is delivered once to each new subscriber; there is no queue,
 *   durable replay, or persistence beyond that one in-memory value.
 *
 * The pure decode helpers below are shared by the entry-route components and are
 * unit-tested directly. Query and fragment location state is preserved
 * losslessly through the shared navigation codec.
 */

const inboundListeners = new Set<(entry: ProductEntry) => void>();

// The one entry decoded from the current document's cold-load URL, delivered as
// an initial snapshot to subscribers that mount after the emit (ProductClient's
// authenticated root is a lazy chunk, so it always subscribes late). Cleared on
// delivery per subscriber via the delivered set below, never persisted.
let initialInboundEntry: ProductEntry | null = null;
const initialDelivered = new WeakSet<(entry: ProductEntry) => void>();

/** Deliver a host-decoded inbound entry to every current subscriber, and retain
 * it as the current document's initial snapshot for subscribers that mount
 * later (the lazily loaded product root). The entry-route component also
 * navigates to the entry's shared route, so the URL remains the fallback. */
export function emitWebInboundEntry(entry: ProductEntry): void {
  initialInboundEntry = entry;
  for (const listener of [...inboundListeners]) {
    initialDelivered.add(listener);
    listener(entry);
  }
}

/** Test-only: drop the retained initial entry and any leftover subscribers
 * between cases so module state cannot leak across tests. */
export function __resetWebInboundEntriesForTest(): void {
  initialInboundEntry = null;
  inboundListeners.clear();
}

export const webProductLinks: ProductLinks = {
  async openExternal(url: string): Promise<void> {
    window.open(url, "_blank", "noopener,noreferrer");
  },
  buildReturnUrl(entry: ProductEntry): string {
    return buildWebReturnUrl(entry, window.location.origin);
  },
  observeInboundEntries(listener: (entry: ProductEntry) => void): () => void {
    inboundListeners.add(listener);
    if (initialInboundEntry !== null && !initialDelivered.has(listener)) {
      initialDelivered.add(listener);
      listener(initialInboundEntry);
    }
    return () => {
      inboundListeners.delete(listener);
    };
  },
};

// --- Desktop deep-link handoff ----------------------------------------------

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * The Desktop deep-link URL scheme for the current browser location: the
 * loopback development scheme `proliferate-local` on localhost, else the
 * production `proliferate` scheme. Mirrors the identical client-side rule the
 * legacy Web handoff pages used.
 */
export function desktopDeepLinkScheme(
  hostname: string = window.location.hostname,
): "proliferate" | "proliferate-local" {
  return LOOPBACK_HOSTNAMES.has(hostname) ? "proliferate-local" : "proliferate";
}

/**
 * Build a Desktop-handoff deep link `<scheme>://<host><suffix>` for the current
 * browser location. `suffix` is the already-encoded path/query/fragment tail
 * (e.g. `/settings/cloud?checkout=success`). Used by the host return routes when
 * a browser return must be handed back to a running Desktop app.
 */
export function buildDesktopDeepLink(host: string, suffix = ""): string {
  return `${desktopDeepLinkScheme()}://${host}${suffix}`;
}

// --- Return-URL encoding ----------------------------------------------------

const RECOGNIZED_INTEGRATION_SOURCES = new Set([
  "integration_oauth_callback",
  "mcp_oauth_callback",
]);

/** The path segment the hosted-Web github-app / settings return URL uses for a
 * settings section. `general` has no dedicated path; it returns to `/settings`. */
export function webSettingsReturnPath(
  section: ProductSettingsEntrySection,
): string {
  switch (section) {
    case "account":
      return "/settings/account";
    case "organization":
      return "/settings/organization";
    case "environments":
      return "/settings/environments";
    case "billing":
      return "/settings/billing";
    case "integrations":
      return "/settings/integrations";
    case "general":
      return "/settings";
  }
}

/**
 * Encode a normalized {@link ProductEntry} as the HTTPS return URL for the given
 * origin. Only the entry kinds hosted Web actually hands to Cloud mutations are
 * encoded; anything without a hosted-Web return route throws rather than
 * inventing one. Query pairs are appended in order (duplicates preserved) and
 * the fragment, when present, is appended with exactly one `#`.
 */
export function buildWebReturnUrl(entry: ProductEntry, origin: string): string {
  switch (entry.kind) {
    case "settings": {
      const params = queryToParams(entry.query);
      if (entry.source) {
        params.set("source", entry.source);
      }
      const search = params.toString();
      return `${origin}${webSettingsReturnPath(entry.section)}${search ? `?${search}` : ""}${fragmentSuffix(entry)}`;
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
      for (const [key, value] of entry.query ?? []) {
        params.append(key, value);
      }
      return `${origin}/plugins/connect/complete?${params.toString()}${fragmentSuffix(entry)}`;
    }
    case "billing-return": {
      const params = queryToParams(entry.query);
      if (entry.status === "success" || entry.status === "cancel") {
        params.set("checkout", entry.status);
      }
      const search = params.toString();
      return `${origin}/settings/cloud${search ? `?${search}` : ""}${fragmentSuffix(entry)}`;
    }
    case "organization-join": {
      const params = queryToParams(entry.query);
      if (entry.serverOrigin) {
        params.set("origin", entry.serverOrigin);
      }
      const search = params.toString();
      return `${origin}/join/${encodeURIComponent(entry.organizationId)}${search ? `?${search}` : ""}${fragmentSuffix(entry)}`;
    }
    case "workspace":
      return `${origin}/workspaces/${encodeURIComponent(entry.workspaceId)}${searchOf(entry)}${fragmentSuffix(entry)}`;
    case "workflow":
      return `${origin}/workflows/${encodeURIComponent(entry.workflowId)}${searchOf(entry)}${fragmentSuffix(entry)}`;
    default:
      throw new Error(`No hosted-Web return URL for entry kind: ${entry.kind}`);
  }
}

function searchOf(entry: ProductEntry): string {
  const search = queryToParams(entry.query).toString();
  return search ? `?${search}` : "";
}

// --- Inbound decoders (pure) ------------------------------------------------

/**
 * Decode a Stripe billing return landing on `/settings/cloud`. The
 * `?checkout=success|cancel` param sets the status; any other/absent value is a
 * neutral `done` return. `returnSurface` and the consumed `checkout` value are
 * lifted out of the surviving query; everything else is preserved in order.
 */
export function decodeWebBillingReturn(parsed: URL): ProductEntry {
  const rawCheckout = parsed.searchParams.get("checkout");
  const status: "success" | "cancel" | "done" =
    rawCheckout === "success"
      ? "success"
      : rawCheckout === "cancel"
        ? "cancel"
        : "done";
  const query = collectQuery(
    parsed.searchParams,
    (key, value) =>
      key === "returnSurface" ||
      (key === "checkout" && (value === "success" || value === "cancel")),
  );
  return withLocation({ kind: "billing-return", status }, query, parsed);
}

/**
 * Decode the integration/MCP OAuth completion landing on
 * `/plugins/connect/complete`. Returns `null` when the `source` is not a
 * recognized integration callback so a malformed completion never becomes a
 * product route. Never exposes OAuth tokens: only the classified
 * `source`/`status`/`flowId`/`failureCode` fields cross into the entry.
 */
export function decodeWebIntegrationComplete(parsed: URL): ProductEntry | null {
  const source = parsed.searchParams.get("source");
  if (source === null || !RECOGNIZED_INTEGRATION_SOURCES.has(source)) {
    return null;
  }
  return buildIntegrationCallbackEntry(
    source as "integration_oauth_callback" | "mcp_oauth_callback",
    parsed,
  );
}

const GITHUB_APP_HOME_SOURCES = new Set([
  "github_app_callback",
  "github_app_installation_callback",
]);

const GITHUB_APP_SETTINGS_PATHS: Record<string, ProductSettingsEntrySection> = {
  "/settings": "general",
  "/settings/account": "account",
  "/settings/organization": "organization",
  "/settings/organizations": "organization",
  "/settings/environments": "environments",
};

/**
 * Decode a hosted-Web GitHub-App settings return. Bounded external-return
 * decoder: only the known settings return paths, and only when a recognized
 * github-app source is present, normalize into a shared settings entry that
 * carries `source: "github_app_callback"` so the shared Cloud/GitHub-App
 * queries refresh. Any other path or source returns `null` (fall through to
 * ProductClient); this is not a generic legacy settings router.
 */
export function decodeWebGithubAppSettingsReturn(parsed: URL): ProductEntry | null {
  const section = GITHUB_APP_SETTINGS_PATHS[parsed.pathname];
  if (section === undefined) {
    return null;
  }
  const source = parsed.searchParams.get("source");
  if (source === null || !GITHUB_APP_HOME_SOURCES.has(source)) {
    return null;
  }
  return buildSettingsEntry(section, parsed);
}

/**
 * Recognize a hosted-Web GitHub-App home return (`/?source=github_app_callback`
 * or `/?source=github_app_installation_callback`). There is no `home`
 * ProductEntry kind, so this returns the recognized source (or `null`); the home
 * decoder route lands on `/` with preserved location state so the shared
 * Cloud/GitHub-App queries refetch on mount.
 */
export function decodeWebGithubAppHomeSource(parsed: URL): string | null {
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return null;
  }
  const source = parsed.searchParams.get("source");
  return source !== null && GITHUB_APP_HOME_SOURCES.has(source) ? source : null;
}
