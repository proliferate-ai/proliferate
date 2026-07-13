/**
 * Tauri updater feed shape + an isolated local updater feed for the
 * desktop-upgrade world (T4-DESKTOP-1).
 *
 * The feed matches the schema the production pipeline publishes
 * (scripts/generate-updater-manifest.mjs) and that the shipped app consumes:
 *
 *   { version, pub_date, notes?, platforms: { "<target>": { signature, url } } }
 *
 * The isolated feed is a localhost HTTP server that INITIALLY advertises
 * nothing newer than N-1 (so the real Tauri `check()` reports no update), then
 * — only after the baseline turn — flips to advertise the exact candidate N
 * updater artifact under the same trust chain. It NEVER moves, mirrors, or
 * writes the public production stable feed; it only ever supplies an alternate
 * endpoint to the real updater engine.
 *
 * Frozen contracts (tests/release/src/foundation/contracts/**) are imported,
 * never edited.
 */

import { createServer, type Server } from "node:http";
import { readFileSync, statSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { AddressInfo } from "node:net";

import type { ReadinessObservation } from "../../contracts/world.js";

/** One platform entry in a Tauri updater manifest. */
export interface FeedPlatformEntry {
  /** Base64 minisign signature of the artifact (public value, not a secret). */
  readonly signature: string;
  /** Immutable artifact URL. */
  readonly url: string;
}

/** The Tauri updater manifest ("latest.json") shape. */
export interface UpdaterFeed {
  readonly version: string;
  readonly pub_date: string;
  /** Optional one-line release-notice title (see desktop-updates.md). */
  readonly notes?: string;
  readonly platforms: Readonly<Record<string, FeedPlatformEntry>>;
}

/** Tauri maps macOS -> "darwin"; these are the only shipped desktop targets. */
export type FeedPlatformKey = "darwin-aarch64" | "darwin-x86_64";

export const ALL_FEED_PLATFORMS: readonly FeedPlatformKey[] = ["darwin-aarch64", "darwin-x86_64"];

/**
 * Parse and validate an updater feed. Rejects a malformed manifest rather than
 * silently tolerating it — a manifest we cannot trust is never used to drive a
 * real update. (desktop-updates.md: a versioned response whose `version` does
 * not match the requested version is rejected.)
 */
export function parseUpdaterFeed(raw: unknown, opts: { expectVersion?: string } = {}): UpdaterFeed {
  if (raw === null || typeof raw !== "object") {
    throw new FeedParseError("feed is not a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  const version = obj.version;
  if (typeof version !== "string" || version.trim().length === 0) {
    throw new FeedParseError("feed.version missing or empty");
  }
  if (opts.expectVersion !== undefined && version !== opts.expectVersion) {
    throw new FeedParseError(
      `feed.version ${version} does not match requested version ${opts.expectVersion}`,
    );
  }
  const pubDate = obj.pub_date;
  if (typeof pubDate !== "string" || pubDate.trim().length === 0) {
    throw new FeedParseError("feed.pub_date missing or empty");
  }
  const platformsRaw = obj.platforms;
  if (platformsRaw === null || typeof platformsRaw !== "object") {
    throw new FeedParseError("feed.platforms missing");
  }
  const platforms: Record<string, FeedPlatformEntry> = {};
  for (const [key, entryRaw] of Object.entries(platformsRaw as Record<string, unknown>)) {
    if (entryRaw === null || typeof entryRaw !== "object") {
      throw new FeedParseError(`feed.platforms.${key} is not an object`);
    }
    const entry = entryRaw as Record<string, unknown>;
    if (typeof entry.signature !== "string" || entry.signature.length === 0) {
      throw new FeedParseError(`feed.platforms.${key}.signature missing`);
    }
    if (typeof entry.url !== "string" || entry.url.length === 0) {
      throw new FeedParseError(`feed.platforms.${key}.url missing`);
    }
    platforms[key] = { signature: entry.signature, url: entry.url };
  }
  if (Object.keys(platforms).length === 0) {
    throw new FeedParseError("feed.platforms is empty");
  }
  const notes = typeof obj.notes === "string" ? obj.notes : undefined;
  return { version, pub_date: pubDate, notes, platforms };
}

export class FeedParseError extends Error {
  constructor(message: string) {
    super(`updater feed parse error: ${message}`);
    this.name = "FeedParseError";
  }
}

/** Semver-ish compare adequate for the x.y.z desktop version line. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10));
  const pb = b.split(".").map((n) => Number.parseInt(n, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) {
      // Fall back to a stable string compare for non-numeric version lines.
      return a === b ? 0 : a < b ? -1 : 1;
    }
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** A staged artifact to advertise (tarball + detached signature on disk). */
export interface StagedArtifact {
  readonly platform: FeedPlatformKey;
  /** Absolute path to the `*.app.tar.gz`. */
  readonly tarballPath: string;
  /** Absolute path to the detached `*.app.tar.gz.sig`. */
  readonly signaturePath: string;
}

/**
 * Isolated local updater feed. Bound to 127.0.0.1 on an ephemeral port. It
 * starts advertising exactly `initialVersion` (== N-1), so the real Tauri
 * `check()` reports NO update. `advertiseCandidate` flips it to the candidate N
 * artifact after the baseline. Every response is served from local staged bytes;
 * nothing is ever written to any public feed.
 */
export class IsolatedUpdaterFeed {
  private server: Server | null = null;
  private manifest: UpdaterFeed;
  private stagedDir: string | null = null;
  private readonly initialVersion: string;

  constructor(initialVersion: string) {
    this.initialVersion = initialVersion;
    // Initial manifest advertises N-1 with no platforms staged: check() sees
    // "not newer than running" and returns no update.
    this.manifest = {
      version: initialVersion,
      pub_date: new Date(0).toISOString(),
      platforms: {},
    };
  }

  /** Start listening; returns the base URL, e.g. http://127.0.0.1:54321 . */
  async start(): Promise<string> {
    if (this.server) throw new Error("feed already started");
    const server = createServer((req, res) => this.handle(req.url ?? "/", res));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as AddressInfo;
    return `http://127.0.0.1:${addr.port}`;
  }

  /** The manifest URL a Tauri updater endpoint points at. */
  feedUrl(): string {
    if (!this.server) throw new Error("feed not started");
    const addr = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${addr.port}/latest.json`;
  }

  /** The version currently advertised. */
  advertisedVersion(): string {
    return this.manifest.version;
  }

  /**
   * Flip the feed to advertise the candidate N artifact(s). Reads the detached
   * signatures verbatim (produced by `tauri build`/`tauri signer`), builds the
   * manifest for the served version, and serves the tarball bytes from disk.
   */
  advertiseCandidate(candidateVersion: string, stagedDir: string, artifacts: readonly StagedArtifact[]): void {
    if (!this.server) throw new Error("feed not started");
    if (artifacts.length === 0) throw new Error("no staged artifacts to advertise");
    if (!isNewerVersion(candidateVersion, this.initialVersion)) {
      throw new Error(
        `candidate ${candidateVersion} is not newer than N-1 ${this.initialVersion}; ` +
          "an isolated feed must only ever advertise a strictly newer signed N",
      );
    }
    const base = this.baseUrl();
    const platforms: Record<string, FeedPlatformEntry> = {};
    for (const a of artifacts) {
      if (!existsSync(a.tarballPath)) throw new Error(`staged tarball missing: ${a.tarballPath}`);
      if (!existsSync(a.signaturePath)) throw new Error(`staged signature missing: ${a.signaturePath}`);
      platforms[a.platform] = {
        signature: readFileSync(a.signaturePath, "utf-8").trim(),
        url: `${base}/${encodeURIComponent(basename(a.tarballPath))}`,
      };
    }
    this.stagedDir = stagedDir;
    this.manifest = { version: candidateVersion, pub_date: new Date().toISOString(), platforms };
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /**
   * GET /latest.json readiness probe: 200 with a JSON body carrying a version
   * string. The initial "advertise nothing newer than N-1" state legitimately
   * has no platforms staged (nothing to download yet), so the probe validates
   * transport + version presence rather than the full download-ready shape.
   */
  async probe(): Promise<ReadinessObservation> {
    const at = new Date().toISOString();
    try {
      const res = await fetch(this.feedUrl());
      const body = (await res.json()) as { version?: unknown };
      const versionOk = typeof body.version === "string" && body.version.length > 0;
      return {
        check: "isolated-updater-feed",
        ok: res.status === 200 && versionOk,
        detail: `GET /latest.json ${res.status} advertising version ${this.manifest.version}`,
        observedAt: at,
      };
    } catch (err) {
      return {
        check: "isolated-updater-feed",
        ok: false,
        detail: `feed probe failed: ${(err as Error).message}`,
        observedAt: at,
      };
    }
  }

  private baseUrl(): string {
    const addr = (this.server as Server).address() as AddressInfo;
    return `http://127.0.0.1:${addr.port}`;
  }

  private handle(url: string, res: import("node:http").ServerResponse): void {
    const path = decodeURIComponent(url.split("?")[0]);
    if (path === "/latest.json" || path === "/") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(this.manifest));
      return;
    }
    if (this.stagedDir) {
      const file = join(this.stagedDir, basename(path));
      if (existsSync(file) && statSync(file).isFile()) {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(readFileSync(file));
        return;
      }
    }
    res.writeHead(404);
    res.end("not found");
  }
}
