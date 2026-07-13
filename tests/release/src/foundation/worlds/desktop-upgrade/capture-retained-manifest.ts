#!/usr/bin/env tsx
/**
 * Retained-manifest capture script (the RECEIPT).
 *
 * READ-ONLY snapshots the live production Desktop updater feed
 * (downloads.proliferate.com/desktop/stable) and writes a
 * RetainedProductionManifest that identifies the last qualified production
 * release N-1 by version, immutable artifact locator, per-platform signature,
 * and the updater trust identity. With --download it stream-hashes each
 * artifact to produce a real sha256 byte digest; without it, byte-digest slots
 * are honestly left unavailable (never fabricated).
 *
 * It NEVER writes, mirrors, or moves the public feed. The trusted pubkey is
 * read from apps/desktop/src-tauri/tauri.conf.json (the exact key the shipped
 * app trusts), not invented.
 *
 * Usage:
 *   tsx capture-retained-manifest.ts [--download] [--platform darwin-aarch64]
 *        [--out <file>] [--feed-url <url>]
 *        [--source-sha <sha>] [--evidence-ref <ref>]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { captureProductionFeed, PRODUCTION_STABLE_FEED_URL } from "./production-feed.js";
import { buildRetainedManifest, retainedManifestHash } from "./retained-manifest.js";
import { ALL_FEED_PLATFORMS, type FeedPlatformKey } from "./feed.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// desktop-upgrade -> worlds -> foundation -> src -> release -> tests -> repo root (six ups).
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..", "..", "..");
const TAURI_CONF = join(REPO_ROOT, "apps", "desktop", "src-tauri", "tauri.conf.json");

interface Args {
  download: boolean;
  platform: FeedPlatformKey | null;
  out: string | null;
  feedUrl: string;
  sourceSha?: string;
  evidenceRef?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const a: Args = { download: false, platform: null, out: null, feedUrl: PRODUCTION_STABLE_FEED_URL };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === "--download") {
      a.download = true;
      continue;
    }
    const v = argv[i + 1];
    if (k === "--platform") a.platform = v as FeedPlatformKey;
    else if (k === "--out") a.out = resolve(v);
    else if (k === "--feed-url") a.feedUrl = v;
    else if (k === "--source-sha") a.sourceSha = v;
    else if (k === "--evidence-ref") a.evidenceRef = v;
    else {
      throw new Error(`unknown flag: ${k}`);
    }
    i += 1;
  }
  return a;
}

/** Read the exact updater pubkey the shipped app trusts. */
export function readTrustedPubkey(tauriConfPath = TAURI_CONF): string {
  const conf = JSON.parse(readFileSync(tauriConfPath, "utf-8")) as {
    plugins?: { updater?: { pubkey?: string } };
  };
  const pubkey = conf.plugins?.updater?.pubkey;
  if (!pubkey) throw new Error(`no plugins.updater.pubkey in ${tauriConfPath}`);
  return pubkey;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const trustedPubkey = readTrustedPubkey();
  const platforms = args.platform ? [args.platform] : ALL_FEED_PLATFORMS;

  console.log(`[capture] reading production feed (READ ONLY): ${args.feedUrl}`);
  const snapshot = await captureProductionFeed({
    feedUrl: args.feedUrl,
    trustedPubkey,
    platforms,
    download: args.download,
  });
  console.log(`[capture] production N-1 version: ${snapshot.feed.version}`);
  if (!args.download) {
    console.log("[capture] NOTE: byte digests NOT captured (metadata-only). Re-run with --download for a real receipt.");
  }

  const manifest = buildRetainedManifest(snapshot, {
    productionSourceSha: args.sourceSha,
    qualificationEvidenceRef: args.evidenceRef,
    platform: args.platform ?? undefined,
  });
  const hash = retainedManifestHash(manifest);

  const outPath =
    args.out ??
    join(REPO_ROOT, "tests", "release", ".output", "desktop-upgrade", `retained-${manifest.productVersion}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[capture] wrote retained manifest -> ${outPath}`);
  console.log(`[capture] retained-manifest hash: ${hash}`);
}

// Only run when invoked directly, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(`[capture] FAILED: ${(e as Error).message}`);
    process.exit(1);
  });
}
