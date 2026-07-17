import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  computeArtifactSetDigest,
  loadRetainedReleaseIndex,
  loadRetainedReleaseReceipt,
  qualifiedReceiptExists,
  RETAINED_RELEASE_INDEX_PATH,
  RetainedReleaseError,
  RETAINED_TARGETS,
  sha256OfText,
  toRetainedReleaseEvidence,
  validateRetainedRelease,
  validateRetainedReleaseReceiptShape,
  verifyRetainedReleaseLive,
  type RetainedReleaseIndexV1,
  type RetainedTarget,
} from "../artifacts/retained-release-set.js";
import { materializeRetainedRelease } from "../artifacts/materialize-retained-release.js";

/**
 * Retained-release receipt operator tool (frozen spec "Retain Exact
 * Production Artifacts for Tier 4"). Two commands:
 *
 *   seal --input <draft.json> --release-id <vX.Y.Z>
 *     Takes a draft receipt (a complete receipt body whose artifact_set_digest
 *     may be absent/stale), computes the artifact-set digest over normalized
 *     content, re-validates the sealed shape, downloads and hash-verifies
 *     every downloadable artifact, optionally verifies live provider identity
 *     (--live: E2B source-tag -> build id), and only then writes the receipt
 *     and appends it to the committed index. For historical/bootstrap
 *     releases this is the "reconstruct only after independently verifying
 *     each retained artifact" path.
 *
 *   validate --release-id <vX.Y.Z> [--targets a,b] [--candidate-sha <sha>] [--live]
 *     Loads the committed receipt via the index, runs shape + policy
 *     validation, materializes the selected targets into a cache with
 *     per-use hash verification, optionally live-verifies provider identity,
 *     and prints the bounded evidence projection. Exit 2 on any validation
 *     failure, before any world side effect.
 *
 * Read-only toward providers: `--live` performs metadata lookups only. This
 * tool never promotes templates, rebuilds artifacts, or mutates aliases.
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

    // Independent verification before the receipt is persisted: every
    // downloadable artifact's bytes must hash to the declared digest.
    const verifyDir = mkdtempSync(path.join(tmpdir(), "retained-seal-"));
    const materialized = await materializeRetainedRelease(sealed, {
      targets: ["desktop", "self-host"],
      cacheDirectory: verifyDir,
    });
    if (args.live) {
      await verifyRetainedReleaseLive(sealed, { resolveE2bTags: e2bTagResolver });
    }

    const receiptFileName = `${sealed.release.release_id}.json`;
    const receiptPath = path.join(path.dirname(args.indexPath), receiptFileName);
    const receiptText = `${JSON.stringify(sealed, null, 2)}\n`;
    writeFileSync(receiptPath, receiptText);
    const receiptSha256 = sha256OfText(receiptText);

    let index: RetainedReleaseIndexV1;
    try {
      index = loadRetainedReleaseIndex(args.indexPath);
    } catch {
      index = { schema_version: 1, kind: "proliferate.retained-release-index", receipts: [] };
    }
    // The index is append-only: re-sealing an existing release must produce
    // identical bytes; differing bytes are a hard failure, not an overwrite.
    const existing = index.receipts.find((entry) => entry.release_id === sealed.release.release_id);
    if (existing) {
      if (existing.receipt_sha256 !== receiptSha256) {
        throw new RetainedReleaseError(
          `Retained release ${sealed.release.release_id} is already indexed with different receipt bytes; ` +
            `receipts are immutable once indexed.`,
        );
      }
    } else {
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
  const entry = index.receipts.find((receipt) => receipt.release_id === args.releaseId);
  if (!entry) {
    throw new RetainedReleaseError(
      `Retained release "${args.releaseId}" is not in the index at ${args.indexPath}.`,
    );
  }
  const receiptPath = path.join(path.dirname(args.indexPath), entry.receipt_path);
  const { receipt, receiptSha256 } = loadRetainedReleaseReceipt(receiptPath);
  if (receiptSha256 !== entry.receipt_sha256) {
    throw new RetainedReleaseError(
      `Receipt bytes for ${args.releaseId} do not match the index ` +
        `(index ${entry.receipt_sha256}, file ${receiptSha256}).`,
    );
  }
  validateRetainedRelease(receipt, {
    requiredTargets: args.targets,
    currentCandidateSourceSha: args.candidateSha,
    qualifiedReceiptExists: qualifiedReceiptExists(index),
  });
  const materialized = await materializeRetainedRelease(receipt, {
    targets: args.targets,
    cacheDirectory: args.cacheDirectory,
  });
  if (args.live) {
    await verifyRetainedReleaseLive(receipt, { resolveE2bTags: e2bTagResolver });
  }
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
