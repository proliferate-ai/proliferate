/**
 * Build a RetainedProductionManifest (the "receipt") from a read-only snapshot
 * of the live production Desktop updater feed.
 *
 * N-1 is resolved from the retained production feed metadata — never inferred
 * by patch arithmetic and never rebuilt from candidate source
 * (tier-4-scenario-contract.md "N-1 means the last qualified production
 * release"). The feed exposes: the current published version, per-platform
 * signature + immutable artifact URL, and (via the app's trusted pubkey) the
 * updater trust identity. It does NOT expose bundled sidecar / seed / catalog /
 * registry / template component identities, so those slots are honestly marked
 * unavailable with a reason rather than filled with a fabricated digest.
 *
 * Frozen contracts (contracts/artifacts.ts) define the manifest shape; they are
 * imported, never edited.
 */

import type {
  ArtifactLocator,
  RetainedProductionManifest,
  Slot,
} from "../../contracts/artifacts.js";
import { canonicalManifestHash } from "../../contracts/hashing.js";
import type { FeedPlatformKey, UpdaterFeed } from "./feed.js";

/** Per-artifact facts observed by the read-only capture. */
export interface CapturedArtifact {
  /** Immutable artifact URL from the feed platform entry. */
  readonly url: string;
  /** Base64 minisign signature from the feed platform entry (public value). */
  readonly signature: string;
  /** Content-Length observed via HEAD, when available. */
  readonly sizeBytes: number | null;
  /**
   * Hex sha256 over the streamed artifact bytes, when the capture downloaded
   * them. When null, the byte digest was not captured (a heavy multi-hundred-MB
   * download) and the corresponding artifact slot is honestly unavailable.
   */
  readonly sha256: string | null;
}

/** A read-only snapshot of the production feed at one instant. */
export interface ProductionFeedSnapshot {
  /** Rolling feed URL that was read (never written), for provenance. */
  readonly feedUrl: string;
  /** The rolling `latest.json` as parsed. */
  readonly feed: UpdaterFeed;
  /**
   * The immutable `desktop/stable/<version>/latest.json` as parsed, proving the
   * rolling feed's version has an immutable record. Null if not captured.
   */
  readonly immutableRecord: UpdaterFeed | null;
  /** The app's trusted updater pubkey (base64), read from tauri.conf.json. */
  readonly trustedPubkey: string;
  /** Per-platform captured artifact facts. */
  readonly artifacts: Readonly<Partial<Record<FeedPlatformKey, CapturedArtifact>>>;
  readonly capturedAt: string;
}

/**
 * Parse the minisign trust identity (key id) from a base64 tauri updater
 * pubkey. The decoded blob's first line is
 * `untrusted comment: minisign public key: <HEXID>`. We return only the
 * fingerprint (never the raw key material) as the trust identity.
 */
export function parsePubkeyFingerprint(pubkeyBase64: string): string {
  let decoded: string;
  try {
    decoded = Buffer.from(pubkeyBase64, "base64").toString("utf-8");
  } catch {
    throw new Error("updater pubkey is not valid base64");
  }
  const match = decoded.match(/minisign public key:\s*([0-9A-Fa-f]+)/);
  if (!match) {
    throw new Error("could not parse minisign key id from updater pubkey comment");
  }
  return match[1].toUpperCase();
}

/**
 * Exact digest guard. Verification is exact-match only: any mismatch (including
 * a null/absent actual) is a hard failure, never a soft skip.
 */
export function verifyArtifactDigest(expected: string, actual: string | null): void {
  if (actual === null) {
    throw new DigestMismatchError(`no digest captured for artifact; expected ${expected}`);
  }
  if (expected.toLowerCase() !== actual.toLowerCase()) {
    throw new DigestMismatchError(`artifact digest mismatch: expected ${expected}, got ${actual}`);
  }
}

export class DigestMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DigestMismatchError";
  }
}

function artifactSlot(captured: CapturedArtifact | undefined): Slot<ArtifactLocator> {
  if (!captured) {
    return { available: false, reason: "platform artifact not present in captured production feed" };
  }
  if (captured.sha256 === null) {
    return {
      available: false,
      reason:
        "artifact bytes not hashed during capture (pass --download to stream-hash the " +
        "multi-hundred-MB tarball); a receipt without a real byte digest is unavailable, not fabricated",
    };
  }
  return {
    available: true,
    value: {
      locator: captured.url,
      digest: captured.sha256,
      algorithm: "sha256",
      sizeBytes: captured.sizeBytes,
    },
  };
}

function updaterSlot(
  captured: CapturedArtifact | undefined,
): Slot<ArtifactLocator & { readonly signature: string }> {
  const base = artifactSlot(captured);
  if (!base.available) return base;
  return { available: true, value: { ...base.value, signature: (captured as CapturedArtifact).signature } };
}

/**
 * Which platform this retained manifest describes. The desktop-upgrade world
 * runs on a macOS host; the host arch selects the retained artifact platform.
 */
export function retainedPlatformForHost(): FeedPlatformKey {
  if (process.platform !== "darwin") {
    throw new Error(`desktop-upgrade retained manifest requires a macOS host; got ${process.platform}`);
  }
  return process.arch === "arm64" ? "darwin-aarch64" : "darwin-x86_64";
}

export interface BuildRetainedManifestOptions {
  /**
   * The production release/source SHA and qualification evidence reference that
   * promoted this N-1. These are receipt provenance the public feed does not
   * itself carry; a real capture threads them from the release record. When
   * unknown they are honestly marked so, never invented.
   */
  readonly productionSourceSha?: string;
  readonly qualificationEvidenceRef?: string;
  /** The macOS platform this receipt is for; defaults to the host. */
  readonly platform?: FeedPlatformKey;
}

/**
 * Build the RetainedProductionManifest from a read-only production feed
 * snapshot. Slots the public feed cannot substantiate (bundled sidecar/seed/
 * catalog/registry/template component identities) are marked unavailable with
 * an explicit reason — a strict Tier 4 desktop run rejects a required
 * unavailable slot rather than passing on a fabricated one.
 */
export function buildRetainedManifest(
  snapshot: ProductionFeedSnapshot,
  options: BuildRetainedManifestOptions = {},
): RetainedProductionManifest {
  const platform = options.platform ?? retainedPlatformForHost();
  const captured = snapshot.artifacts[platform];
  const version = snapshot.feed.version;

  const trustIdentity = parsePubkeyFingerprint(snapshot.trustedPubkey);

  const unavailable = (reason: string) => ({ available: false as const, reason });

  return {
    schemaVersion: 1,
    kind: "retained-production",
    sourceSha: options.productionSourceSha ?? `unknown-source-sha-for-${version}`,
    productVersion: version,
    qualificationEvidenceRef:
      options.qualificationEvidenceRef ?? `unbound:${snapshot.feedUrl}@${snapshot.capturedAt}`,
    desktopApp: artifactSlot(captured),
    desktopUpdater: updaterSlot(captured),
    desktopUpdaterTrustIdentity: { available: true, value: trustIdentity },
    // The public updater feed does not disclose bundled sidecar/seed/catalog/
    // registry versions or template identities. These are populated only from
    // the retained release's own recorded manifest, not from the feed.
    bundledAnyharnessVersion: unavailable("bundled AnyHarness version not disclosed by the public feed"),
    bundledWorkerVersion: unavailable("bundled Worker version not disclosed by the public feed"),
    seedHash: unavailable("agent seed hash not disclosed by the public feed"),
    catalogHash: unavailable("bundled catalog hash not disclosed by the public feed"),
    registryHash: unavailable("trusted registry hash not disclosed by the public feed"),
    e2bTemplate: unavailable("desktop world does not use an E2B template"),
    templateComponents: unavailable("desktop world does not use an E2B template"),
    installedAgentPins: unavailable("installed agent pins not disclosed by the public feed"),
  };
}

/** Canonical hash of a retained manifest, for run identity binding. */
export function retainedManifestHash(manifest: RetainedProductionManifest): string {
  return canonicalManifestHash(manifest);
}
