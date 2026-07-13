/**
 * READ-ONLY reader for the live production Desktop updater feed
 * (downloads.proliferate.com/desktop/stable). This module can only GET/HEAD;
 * it never publishes, mirrors, or mutates the public feed, and it refuses any
 * non-GET/HEAD method. It is the sole network surface the desktop-upgrade world
 * uses against production, and it exists to produce the retained-manifest
 * receipt and to resolve N-1 identity.
 */

import { createHash } from "node:crypto";

import { parseUpdaterFeed, ALL_FEED_PLATFORMS, type FeedPlatformKey } from "./feed.js";
import type { CapturedArtifact, ProductionFeedSnapshot } from "./retained-manifest.js";

export const PRODUCTION_STABLE_FEED_URL =
  "https://downloads.proliferate.com/desktop/stable/latest.json";

/**
 * Hard guard: this module refuses to issue anything but a read against the
 * public feed. Any attempt to pass a mutating method is a programming error.
 */
function assertReadOnly(method: string): void {
  if (method !== "GET" && method !== "HEAD") {
    throw new Error(
      `production feed access is READ ONLY; refusing ${method}. The public stable feed is never written by tests.`,
    );
  }
}

async function readJson(url: string, timeoutMs: number): Promise<unknown> {
  assertReadOnly("GET");
  const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function headArtifact(url: string, timeoutMs: number): Promise<{ sizeBytes: number | null }> {
  assertReadOnly("HEAD");
  const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HEAD ${url} -> ${res.status}`);
  const len = res.headers.get("content-length");
  return { sizeBytes: len ? Number.parseInt(len, 10) : null };
}

/** Stream-download and sha256 without buffering the whole artifact in memory. */
async function streamSha256(url: string, timeoutMs: number): Promise<string> {
  assertReadOnly("GET");
  const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok || !res.body) throw new Error(`GET ${url} -> ${res.status}`);
  const hash = createHash("sha256");
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) hash.update(value);
  }
  return hash.digest("hex");
}

export interface CaptureOptions {
  readonly feedUrl?: string;
  /** The app's trusted updater pubkey (base64), from tauri.conf.json. */
  readonly trustedPubkey: string;
  /** Platforms to capture; defaults to all shipped desktop platforms. */
  readonly platforms?: readonly FeedPlatformKey[];
  /**
   * When true, stream-download each artifact and compute its real sha256. This
   * is the honest byte-digest receipt but is a multi-hundred-MB download per
   * platform. When false (default), only metadata (URL, signature, size) is
   * captured and byte-digest slots are honestly left unavailable.
   */
  readonly download?: boolean;
  readonly timeoutMs?: number;
}

/**
 * Read the production feed and return a snapshot suitable for
 * buildRetainedManifest. Purely read-only.
 */
export async function captureProductionFeed(opts: CaptureOptions): Promise<ProductionFeedSnapshot> {
  const feedUrl = opts.feedUrl ?? PRODUCTION_STABLE_FEED_URL;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const platforms = opts.platforms ?? ALL_FEED_PLATFORMS;

  const feed = parseUpdaterFeed(await readJson(feedUrl, timeoutMs));

  // The immutable per-version record proves the rolling feed points at a real
  // published version; rejected if its version does not match (desktop-updates.md).
  const immutableUrl = feedUrl.replace(/\/latest\.json$/, `/${feed.version}/latest.json`);
  let immutableRecord = null;
  try {
    immutableRecord = parseUpdaterFeed(await readJson(immutableUrl, timeoutMs), {
      expectVersion: feed.version,
    });
  } catch {
    immutableRecord = null;
  }

  const artifacts: Partial<Record<FeedPlatformKey, CapturedArtifact>> = {};
  for (const platform of platforms) {
    const entry = feed.platforms[platform];
    if (!entry) continue;
    const { sizeBytes } = await headArtifact(entry.url, timeoutMs).catch(() => ({ sizeBytes: null }));
    const sha256 = opts.download ? await streamSha256(entry.url, Math.max(timeoutMs, 600_000)) : null;
    artifacts[platform] = { url: entry.url, signature: entry.signature, sizeBytes, sha256 };
  }

  return {
    feedUrl,
    feed,
    immutableRecord,
    trustedPubkey: opts.trustedPubkey,
    artifacts,
    capturedAt: new Date().toISOString(),
  };
}
