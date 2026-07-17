import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  RetainedReleaseError,
  type RetainedReleaseReceiptV1,
  type RetainedTarget,
} from "./retained-release-set.js";

/**
 * Materializes a validated retained-release receipt's downloadable artifacts
 * into a run/cache directory, verifying SHA-256 on EVERY use — a cache hit is
 * re-hashed before it is trusted, so a corrupted or tampered cache entry is a
 * RetainedReleaseError, never silently launched bytes (frozen spec
 * "Local and Actions behavior": a cache hit never bypasses validation).
 *
 * Local runs and GitHub Actions runs call this same code with the same
 * receipt: only where the cache directory lives differs. An `oci` artifact
 * (the self-host server image) and the E2B template are provider-side and are
 * not byte-materialized here — their identities are validated by
 * `validateRetainedReleaseReceiptShape` / `verifyRetainedReleaseLive`, and
 * their consumers (docker, E2B provisioning) pin by digest/immutable id.
 */

export interface MaterializedRetainedArtifact {
  /** Stable retained artifact id, e.g. `desktop/darwin-aarch64/package`. */
  artifact: string;
  sha256: string;
  path: string;
}

export interface MaterializeRetainedReleaseOptions {
  targets: readonly RetainedTarget[];
  cacheDirectory: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface DownloadableArtifact {
  artifact: string;
  locator: string;
  sha256: string;
}

/** The byte-downloadable artifact set for the selected targets. */
export function downloadableRetainedArtifacts(
  receipt: RetainedReleaseReceiptV1,
  targets: readonly RetainedTarget[],
): DownloadableArtifact[] {
  const artifacts: DownloadableArtifact[] = [];
  if (targets.includes("desktop")) {
    for (const pkg of receipt.desktop.packages) {
      artifacts.push({
        artifact: `desktop/${pkg.platform}/package`,
        locator: pkg.immutable_locator,
        sha256: pkg.sha256,
      });
      artifacts.push({
        artifact: `desktop/${pkg.platform}/signature`,
        locator: pkg.signature_locator,
        sha256: pkg.sha256_signature,
      });
    }
  }
  if (targets.includes("self-host")) {
    artifacts.push({
      artifact: "self-host/deploy-bundle",
      locator: receipt.self_host.deploy_bundle_locator,
      sha256: receipt.self_host.deploy_bundle_sha256,
    });
  }
  // managed-runtime has no byte download: its retained identity is the
  // immutable E2B template id/build id, consumed provider-side.
  return artifacts;
}

function sha256OfBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sha256OfFile(filePath: string): Promise<string> {
  return sha256OfBytes(await readFile(filePath));
}

/**
 * Materializes one artifact: returns the verified cached copy if its bytes
 * still hash correctly, otherwise downloads, verifies, and atomically
 * installs into the cache. Every returned path has been hash-verified in
 * this call.
 */
async function materializeOne(
  entry: DownloadableArtifact,
  cacheDirectory: string,
  fetchImpl: typeof fetch,
): Promise<MaterializedRetainedArtifact> {
  // encodeURIComponent is injective on artifact ids (slashes encode to %2F),
  // so distinct ids can never collide onto one cache file. The declared hash
  // is part of the key so a receipt change can never alias stale bytes.
  const cachePath = path.join(
    cacheDirectory,
    `${encodeURIComponent(entry.artifact)}-${entry.sha256.slice(0, 16)}`,
  );
  await mkdir(cacheDirectory, { recursive: true });

  let cached = false;
  try {
    cached = (await stat(cachePath)).isFile();
  } catch {
    cached = false;
  }
  if (cached) {
    const cachedSha = await sha256OfFile(cachePath);
    if (cachedSha === entry.sha256) {
      return { artifact: entry.artifact, sha256: cachedSha, path: cachePath };
    }
    // Corrupt cache entry: fall through to a fresh verified download rather
    // than trusting or silently deleting ambiguous bytes.
  }

  let response: Response;
  try {
    response = await fetchImpl(entry.locator);
  } catch (error) {
    throw new RetainedReleaseError(
      `Retained artifact "${entry.artifact}" could not be downloaded: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!response.ok) {
    throw new RetainedReleaseError(
      `Retained artifact "${entry.artifact}" download failed with HTTP ${response.status}.`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = sha256OfBytes(bytes);
  if (actual !== entry.sha256) {
    throw new RetainedReleaseError(
      `Retained artifact "${entry.artifact}" bytes do not match the receipt SHA-256 ` +
        `(receipt ${entry.sha256}, downloaded ${actual}). Treat as a release/security incident.`,
    );
  }
  const tempPath = `${cachePath}.tmp-${process.pid}`;
  await writeFile(tempPath, bytes);
  await rename(tempPath, cachePath);
  return { artifact: entry.artifact, sha256: actual, path: cachePath };
}

/**
 * Materializes every downloadable artifact for the selected targets. Fails
 * closed on the first missing/mismatched artifact; a partial cache is left
 * only with fully verified entries (installs are atomic).
 */
export async function materializeRetainedRelease(
  receipt: RetainedReleaseReceiptV1,
  options: MaterializeRetainedReleaseOptions,
): Promise<MaterializedRetainedArtifact[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const artifacts = downloadableRetainedArtifacts(receipt, options.targets);
  const materialized: MaterializedRetainedArtifact[] = [];
  for (const entry of artifacts) {
    materialized.push(await materializeOne(entry, options.cacheDirectory, fetchImpl));
  }
  return materialized;
}
