import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assertIndexReceiptsBound,
  computeArtifactSetDigest,
  loadIndexedRetainedReceipt,
  loadRetainedReleaseIndex,
  loadRetainedReleaseIndexOrInit,
  qualifiedReceiptExists,
  RETAINED_RELEASE_INDEX_PATH,
  RetainedReleaseError,
  RETAINED_TARGETS,
  sha256OfText,
  toRetainedReleaseEvidence,
  validateRetainedRelease,
  validateRetainedReleaseReceiptShape,
  verifyRetainedReleaseLive,
  type RetainedReleaseLiveChecks,
  type RetainedReleaseReceiptV1,
  type RetainedTarget,
} from "../artifacts/retained-release-set.js";
import { materializeRetainedRelease } from "../artifacts/materialize-retained-release.js";

/**
 * Retained-release receipt operator tool (frozen spec "Retain Exact
 * Production Artifacts for Tier 4"). Two commands:
 *
 *   seal --input <draft.json> [--live]
 *     Takes a draft receipt (a complete receipt body whose artifact_set_digest
 *     may be absent/stale), computes the artifact-set digest over normalized
 *     content, re-validates the sealed shape, downloads and hash-verifies
 *     every downloadable artifact, optionally verifies live provider identity
 *     (--live: E2B source-tag -> build id AND the recorded OCI digest), and
 *     only then writes the receipt and appends it to the committed index.
 *     ALL preflight (including the immutability check against an existing
 *     indexed receipt) happens before any byte is written: a differing reseal
 *     leaves both the receipt and the index untouched. Only a genuinely
 *     ABSENT index file initializes a new empty index; an unreadable or
 *     corrupt index fails closed so retention roots can never be silently
 *     discarded. For historical/bootstrap releases this is the "reconstruct
 *     only after independently verifying each retained artifact" path.
 *
 *   validate --release-id <vX.Y.Z> [--targets a,b] [--candidate-sha <sha>] [--live]
 *     Loads the committed receipt via the index (every entry bound to its
 *     receipt's bytes AND identity/state before policy is derived), runs
 *     shape + policy validation, materializes the selected targets into a
 *     cache with per-use hash verification, optionally live-verifies provider
 *     identity, and prints the bounded evidence projection. Exit 2 on any
 *     validation failure, before any world side effect.
 *
 * Read-only toward providers: `--live` performs metadata lookups only (E2B
 * template tags, container-registry manifest digests). This tool never
 * promotes templates, rebuilds artifacts, or mutates aliases.
 */

interface CliArgs {
  command: "seal" | "validate";
  input?: string;
  releaseId?: string;
  targets: RetainedTarget[];
  candidateSha?: string;
  live: boolean;
  cacheDirectory: string;
  indexPath: string;
}

function parseArgs(argv: string[]): CliArgs {
  const [command, ...rest] = argv;
  if (command !== "seal" && command !== "validate") {
    throw new RetainedReleaseError(
      "Usage: retained-release <seal|validate> [--input <draft.json>] [--release-id <vX.Y.Z>] " +
        "[--targets desktop,managed-runtime,self-host] [--candidate-sha <sha>] [--live] " +
        "[--cache-dir <dir>] [--index <path>]",
    );
  }
  const args: CliArgs = {
    command,
    targets: [...RETAINED_TARGETS],
    live: false,
    cacheDirectory: path.join(
      process.env.HOME ?? tmpdir(),
      ".proliferate-local",
      "qualification",
      "retained-cache",
    ),
    indexPath: RETAINED_RELEASE_INDEX_PATH,
  };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    switch (arg) {
      case "--input":
        args.input = rest[++i];
        break;
      case "--release-id":
        args.releaseId = rest[++i];
        break;
      case "--targets":
        args.targets = (rest[++i] ?? "").split(",").map((entry) => entry.trim()) as RetainedTarget[];
        break;
      case "--candidate-sha":
        args.candidateSha = rest[++i];
        break;
      case "--live":
        args.live = true;
        break;
      case "--cache-dir":
        args.cacheDirectory = rest[++i] ?? args.cacheDirectory;
        break;
      case "--index":
        args.indexPath = rest[++i] ?? args.indexPath;
        break;
      default:
        throw new RetainedReleaseError(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function e2bTagResolver(templateFamily: string): Promise<Array<{ tag: string; buildId: string }>> {
  const apiKey = process.env.E2B_API_KEY ?? process.env.RELEASE_E2E_E2B_API_KEY;
  if (!apiKey) {
    throw new RetainedReleaseError(
      "--live E2B verification needs E2B_API_KEY or RELEASE_E2E_E2B_API_KEY in the environment.",
    );
  }
  const { Template } = await import("e2b");
  const family = templateFamily.split("/").at(-1) ?? templateFamily;
  const tags = (await Template.getTags(family, { apiKey })) as Array<{ tag: string; buildId: string }>;
  return tags.map((entry) => ({ tag: entry.tag, buildId: entry.buildId }));
}

/**
 * Read-only OCI manifest-digest verification for `ghcr.io/...` references via
 * the registry HTTP API (anonymous pull token for public images,
 * GH_TOKEN/GITHUB_TOKEN for private ones). The receipt records
 * `repo@sha256:...`; the registry is asked for that exact manifest — a
 * registry that no longer serves it is drift/loss. Returns the digest the
 * registry reports serving, which the caller compares to the recorded one.
 */
async function ociDigestResolver(reference: string, declaredDigest: string): Promise<string> {
  const [registry, ...repoParts] = reference.split("/");
  const repository = repoParts.join("/");
  if (registry !== "ghcr.io" || repository.length === 0) {
    throw new RetainedReleaseError(
      `--live OCI verification supports ghcr.io references only (got "${registry}").`,
    );
  }
  const token = await ghcrToken(repository);
  const response = await fetch(`https://ghcr.io/v2/${repository}/manifests/${declaredDigest}`, {
    method: "HEAD",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept:
        "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, " +
        "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
    },
  });
  if (!response.ok) {
    throw new RetainedReleaseError(
      `--live OCI verification: ghcr.io no longer serves the recorded manifest for ${repository} ` +
        `(HTTP ${response.status}); retained image drift or loss.`,
    );
  }
  return response.headers.get("docker-content-digest") ?? "";
}

async function ghcrToken(repository: string): Promise<string> {
  const response = await fetch(
    `https://ghcr.io/token?scope=repository:${repository}:pull`,
    process.env.GH_TOKEN || process.env.GITHUB_TOKEN
      ? {
          headers: {
            Authorization: `Basic ${Buffer.from(`x:${process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN}`).toString("base64")}`,
          },
        }
      : undefined,
  );
  if (!response.ok) {
    throw new RetainedReleaseError(`--live OCI verification: ghcr.io token request failed (HTTP ${response.status}).`);
  }
  const body = (await response.json()) as { token?: string };
  if (!body.token) {
    throw new RetainedReleaseError("--live OCI verification: ghcr.io returned no pull token.");
  }
  return body.token;
}

/**
 * The full frozen `--live` check set (RR-CONTROL-004): E2B immutable
 * source-tag -> build identity AND the recorded OCI manifest digest. Template
 * COMPONENT identities (versions/catalog inside the image) require booting a
 * sandbox from the template — a world side effect this read-only tool must
 * not perform; they are asserted by the T4-RUNTIME-1 baseline against the
 * same receipt (`expectedComponents`) when the live world runs.
 */
function liveChecks(receipt: RetainedReleaseReceiptV1): RetainedReleaseLiveChecks {
  const declaredDigest = receipt.self_host.server_image_digest.split("@")[1] ?? "";
  return {
    resolveE2bTags: e2bTagResolver,
    resolveOciDigest: (reference: string) => ociDigestResolver(reference, declaredDigest),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "seal") {
    if (!args.input) {
      throw new RetainedReleaseError("seal requires --input <draft.json>.");
    }
    const draft = JSON.parse(readFileSync(args.input, "utf8")) as Record<string, unknown>;
    delete draft.artifact_set_digest;
    const digest = computeArtifactSetDigest(
      draft as unknown as Parameters<typeof computeArtifactSetDigest>[0],
    );
    const sealed = validateRetainedReleaseReceiptShape({ ...draft, artifact_set_digest: digest });
    const receiptFileName = `${sealed.release.release_id}.json`;
    const receiptPath = path.join(path.dirname(args.indexPath), receiptFileName);
    const receiptText = `${JSON.stringify(sealed, null, 2)}\n`;
    const receiptSha256 = sha256OfText(receiptText);

    // ALL preflight before ANY write (RR-CONTROL-001/002): only a genuinely
    // absent index initializes empty; any other load failure aborts here. A
    // release already indexed must reseal to identical bytes — a differing
    // reseal aborts with the committed receipt and index untouched.
    const index = loadRetainedReleaseIndexOrInit(args.indexPath);
    const existing = index.receipts.find((entry) => entry.release_id === sealed.release.release_id);
    if (existing && existing.receipt_sha256 !== receiptSha256) {
      throw new RetainedReleaseError(
        `Retained release ${sealed.release.release_id} is already indexed with different receipt bytes; ` +
          `receipts are immutable once indexed. Nothing was written.`,
      );
    }
    if (index.receipts.length > 0) {
      assertIndexReceiptsBound(index, args.indexPath);
    }

    // Independent verification, still before persistence: every downloadable
    // artifact's bytes must hash to the declared digest, and --live must prove
    // provider identity (E2B build + OCI digest).
    const verifyDir = mkdtempSync(path.join(tmpdir(), "retained-seal-"));
    const materialized = await materializeRetainedRelease(sealed, {
      targets: ["desktop", "self-host"],
      cacheDirectory: verifyDir,
    });
    if (args.live) {
      await verifyRetainedReleaseLive(sealed, liveChecks(sealed));
    }

    writeFileSync(receiptPath, receiptText);
    if (!existing) {
      index.receipts.push({
        release_id: sealed.release.release_id,
        source_sha: sealed.release.source_sha,
        qualification_state: sealed.release.qualification_state,
        receipt_path: receiptFileName,
        receipt_sha256: receiptSha256,
      });
      writeFileSync(args.indexPath, `${JSON.stringify(index, null, 2)}\n`);
    }

    console.log(
      JSON.stringify(
        toRetainedReleaseEvidence(sealed, receiptSha256, ["desktop", "managed-runtime", "self-host"],
          materialized.map((entry) => ({ artifact: entry.artifact, digest: entry.sha256 }))),
        null,
        2,
      ),
    );
    return;
  }

  if (!args.releaseId) {
    throw new RetainedReleaseError("validate requires --release-id <vX.Y.Z>.");
  }
  const index = loadRetainedReleaseIndex(args.indexPath);
  // Bind every entry before deriving bootstrap policy (RR-CONTROL-005).
  assertIndexReceiptsBound(index, args.indexPath);
  const { receipt, receiptSha256 } = loadIndexedRetainedReceipt(index, args.indexPath, args.releaseId);
  validateRetainedRelease(receipt, {
    requiredTargets: args.targets,
    currentCandidateSourceSha: args.candidateSha,
    qualifiedReceiptExists: qualifiedReceiptExists(index),
  });
  if (args.live) {
    await verifyRetainedReleaseLive(receipt, liveChecks(receipt));
  }
  const materialized = await materializeRetainedRelease(receipt, {
    targets: args.targets,
    cacheDirectory: args.cacheDirectory,
  });
  console.log(
    JSON.stringify(
      toRetainedReleaseEvidence(
        receipt,
        receiptSha256,
        args.targets,
        materialized.map((item) => ({ artifact: item.artifact, digest: item.sha256 })),
      ),
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  // Exit 2 = invalid invocation/receipt/artifact input, before any world side
  // effect; the message never embeds raw receipt JSON or provider responses.
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
});
