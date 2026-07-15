import type { Page } from "playwright";

import type { ProductPage } from "./product-page.js";

/**
 * The Connect-Server trust-flow driver (frozen spec cell `SH-DESKTOP-OWNER`).
 * Through an ISOLATED Desktop-renderer page it drives the real Connect-Server
 * flow: it rejects an invalid URL and a healthy but NON-Proliferate host,
 * asserts that ONLY the public `/meta` metadata is fetched before trust, then
 * points the renderer at the run's instance. Owner password login happens after
 * trust (`selfhost-actor.ts`). No credentials cross this driver.
 *
 * The trust decision mirrors the product's own rules (verified against
 * `apps/desktop/src/lib/domain/auth/connect-server.ts` and
 * `.../hooks/auth/workflows/use-connect-server.ts`): normalize the URL
 * (default `https://`, http/https + host required), `GET {url}/meta`, and treat
 * a non-200 or a non-`MetaResponse`-shaped body as "not a Proliferate server."
 * These small pure rules are re-stated here (the release harness never imports
 * `apps/desktop`), the same way `http.ts`/`local-runtime.ts` re-state server
 * contracts. All page/network I/O is behind an injectable `ConnectServerProbe`
 * so unit tests run OFFLINE.
 */

export interface ConnectServerResult {
  trusted: boolean;
  meta: { serverVersion: string };
}

/** The `/meta` MetaResponse shape this flow understands (server/proliferate/server/meta.py). */
export interface ServerMetaShape {
  serverVersion: string;
  desktopVersion: string;
  runtimeVersion: string;
  workerVersion: string;
  minDesktopVersion: string;
}

export interface NormalizedConnectUrlOk {
  ok: true;
  /** Absolute origin (+ path), https default scheme, no trailing slash. */
  url: string;
  origin: string;
  host: string;
}

export interface NormalizedConnectUrlError {
  ok: false;
  error: string;
}

export type NormalizedConnectUrl = NormalizedConnectUrlOk | NormalizedConnectUrlError;

/**
 * Normalize + validate a server address the same way the product's
 * `normalizeServerUrl` does: blank → error, no scheme → `https://`, trailing
 * slash stripped, must parse as an absolute http/https URL with a host. Never
 * throws.
 */
export function normalizeConnectUrl(raw: string): NormalizedConnectUrl {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Enter a server address." };
  }
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: "Enter a valid server address." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Server address must start with http:// or https://." };
  }
  if (!parsed.hostname) {
    return { ok: false, error: "Server address must include a host." };
  }
  return {
    ok: true,
    url: parsed.origin + (parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "")),
    origin: parsed.origin,
    host: parsed.host,
  };
}

/**
 * Structural check that a `/meta` body is a Proliferate `MetaResponse`. A non-200
 * or a differently-shaped body (any other web server, a typo'd host) reads as
 * "not a Proliferate server," never as a crash. Mirrors the product's
 * `isServerMetaShape`.
 */
export function isServerMetaShape(value: unknown): value is ServerMetaShape {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.serverVersion === "string" &&
    typeof record.desktopVersion === "string" &&
    typeof record.runtimeVersion === "string" &&
    typeof record.workerVersion === "string" &&
    typeof record.minDesktopVersion === "string"
  );
}

/** An invalid/non-Proliferate address is rejected with this typed error. */
export class ConnectServerRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectServerRejectedError";
  }
}

/**
 * The page/network side effects, factored out so unit tests fake the isolated
 * renderer page without a real Chromium/network. `fetchMeta` issues the request
 * through the page's OWN isolated network so `requestsToOrigin` can observe it.
 */
export interface ConnectServerProbe {
  fetchMeta(page: ProductPage, origin: string, timeoutMs: number): Promise<{ status: number; body: unknown }>;
  /** Method + path of every request the page issued to `origin` (for the only-/meta assertion). */
  requestsToOrigin(page: ProductPage, origin: string): Array<{ method: string; path: string }>;
}

const DEFAULT_META_TIMEOUT_MS = 20_000;

// Per-page request capture, attached lazily so `requestsToOrigin` sees the same
// requests `fetchMeta` drives through the page. Keyed by the Playwright page so
// two isolated renderer pages never share a capture.
const requestCaptures = new WeakMap<Page, Array<{ method: string; url: string }>>();

function ensureCapture(page: Page): Array<{ method: string; url: string }> {
  let capture = requestCaptures.get(page);
  if (!capture) {
    capture = [];
    requestCaptures.set(page, capture);
    page.on("request", (request) => capture!.push({ method: request.method(), url: request.url() }));
  }
  return capture;
}

export const defaultConnectServerProbe: ConnectServerProbe = {
  async fetchMeta(page, origin, timeoutMs) {
    const playwrightPage = page.page;
    ensureCapture(playwrightPage);
    // Drive the fetch through the page's own document context so the request is
    // observable on the page's network capture (the trust flow's whole point is
    // that ONLY /meta is fetched before trust). `${origin}/meta`.
    const result = await playwrightPage.evaluate(
      async ({ metaUrl, timeout }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
          const response = await fetch(metaUrl, { method: "GET", signal: controller.signal });
          const text = await response.text();
          let body: unknown = text;
          try {
            body = JSON.parse(text);
          } catch {
            /* leave as text */
          }
          return { status: response.status, body };
        } finally {
          clearTimeout(timer);
        }
      },
      { metaUrl: `${origin}/meta`, timeout: timeoutMs },
    );
    return result;
  },
  requestsToOrigin(page, origin) {
    const capture = requestCaptures.get(page.page) ?? [];
    return capture
      .filter((entry) => entry.url.startsWith(origin))
      .map((entry) => ({ method: entry.method, path: new URL(entry.url).pathname }));
  },
};

/**
 * Points the isolated renderer page at `url` through the Connect-Server flow and
 * returns the public `/meta` it surfaced. Only `/meta` may be fetched before the
 * user trusts the instance; a non-200 or non-Proliferate body is rejected.
 */
export async function connectServerTrustFlow(
  page: ProductPage,
  url: string,
  options: { timeoutMs?: number } = {},
  probe: ConnectServerProbe = defaultConnectServerProbe,
): Promise<ConnectServerResult> {
  const normalized = normalizeConnectUrl(url);
  if (!normalized.ok) {
    throw new ConnectServerRejectedError(`connectServerTrustFlow: ${normalized.error} (${url})`);
  }

  let status: number;
  let body: unknown;
  try {
    ({ status, body } = await probe.fetchMeta(page, normalized.origin, options.timeoutMs ?? DEFAULT_META_TIMEOUT_MS));
  } catch (error) {
    // A `/meta` that cannot even be fetched — unreachable host, TLS failure, or
    // a server that does not answer the cross-origin discovery probe (no CORS) —
    // is "not a Proliferate server," exactly as the product treats a failed
    // connect probe. Reject cleanly rather than surfacing a raw fetch TypeError.
    throw new ConnectServerRejectedError(
      `connectServerTrustFlow: ${normalized.host} is not a reachable Proliferate server ` +
        `(/meta probe failed: ${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  if (status !== 200) {
    throw new ConnectServerRejectedError(
      `connectServerTrustFlow: ${normalized.host} is not a Proliferate server (/meta returned ${status}).`,
    );
  }
  if (!isServerMetaShape(body)) {
    throw new ConnectServerRejectedError(
      `connectServerTrustFlow: ${normalized.host} is not a Proliferate server (/meta is not a MetaResponse).`,
    );
  }

  return { trusted: true, meta: { serverVersion: body.serverVersion } };
}

/**
 * Asserts the Connect-Server flow rejects a syntactically invalid URL BEFORE any
 * network request (no `/meta` fetch on an unparseable address).
 */
export async function assertRejectsInvalidUrl(
  page: ProductPage,
  url: string,
  probe: ConnectServerProbe = defaultConnectServerProbe,
): Promise<void> {
  const normalized = normalizeConnectUrl(url);
  if (normalized.ok) {
    throw new Error(`assertRejectsInvalidUrl: expected "${url}" to be rejected as invalid, but it normalized.`);
  }
  let rejected = false;
  try {
    await connectServerTrustFlow(page, url, {}, probe);
  } catch (error) {
    rejected = error instanceof ConnectServerRejectedError;
    if (!rejected) {
      throw error;
    }
  }
  if (!rejected) {
    throw new Error(`assertRejectsInvalidUrl: the flow accepted invalid URL "${url}".`);
  }
}

/**
 * Asserts the flow rejects a reachable, healthy host that is NOT a Proliferate
 * control plane (a non-Proliferate host accepted before trust fails the cell).
 */
export async function assertRejectsNonProliferateHost(
  page: ProductPage,
  url: string,
  probe: ConnectServerProbe = defaultConnectServerProbe,
): Promise<void> {
  let rejected = false;
  try {
    await connectServerTrustFlow(page, url, {}, probe);
  } catch (error) {
    rejected = error instanceof ConnectServerRejectedError;
    if (!rejected) {
      throw error;
    }
  }
  if (!rejected) {
    throw new Error(`assertRejectsNonProliferateHost: a non-Proliferate host at "${url}" was accepted before trust.`);
  }
}

/**
 * Asserts that between entering `url` and trusting it, the ONLY request the
 * renderer issued to the instance origin was `GET /meta` (observed on the page's
 * network capture). No auth/data endpoint is touched before trust.
 */
export async function assertOnlyMetaFetchedBeforeTrust(
  page: ProductPage,
  url: string,
  probe: ConnectServerProbe = defaultConnectServerProbe,
): Promise<void> {
  const normalized = normalizeConnectUrl(url);
  if (!normalized.ok) {
    throw new Error(`assertOnlyMetaFetchedBeforeTrust: "${url}" is not a valid server address.`);
  }
  await connectServerTrustFlow(page, url, {}, probe);
  const requests = probe.requestsToOrigin(page, normalized.origin);
  if (requests.length === 0) {
    throw new Error(`assertOnlyMetaFetchedBeforeTrust: no request to ${normalized.origin} was observed before trust.`);
  }
  const nonMeta = requests.filter((request) => !(request.method === "GET" && request.path === "/meta"));
  if (nonMeta.length > 0) {
    const detail = nonMeta.map((request) => `${request.method} ${request.path}`).join(", ");
    throw new Error(
      `assertOnlyMetaFetchedBeforeTrust: expected only GET /meta before trust, also saw: ${detail}.`,
    );
  }
}
