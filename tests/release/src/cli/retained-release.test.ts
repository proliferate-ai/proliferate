import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  computeArtifactSetDigest,
  type RetainedReleaseReceiptV1,
} from "../artifacts/retained-release-set.js";

/**
 * Command-level regressions for the seal write-ordering invariants
 * (RR-CONTROL-001/002): ALL preflight — existing-receipt immutability and
 * index integrity — happens before ANY write or download, so every rejection
 * below must leave the committed receipt and index byte-identical. The cases
 * are hermetic precisely because preflight precedes network I/O: a correct
 * implementation exits 2 without ever fetching an artifact.
 */

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "retained-release.ts");
const TSX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "node_modules", ".bin", "tsx");

const SHA = "e61afc274593085e51870b24269f718a543b88b4";
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

function receiptBody(anyharnessVersion = "0.3.38"): Omit<RetainedReleaseReceiptV1, "artifact_set_digest"> {
  return {
    schema_version: 1,
    kind: "proliferate.retained-release",
    release: {
      release_id: "v0.3.38",
      release_tag: "proliferate-v0.3.38",
      source_sha: SHA,
      published_at: "2026-07-17T01:07:21.493Z",
      qualification_state: "bootstrap_unqualified",
      qualification_evidence: null,
    },
    desktop: {
      version: "0.3.38",
      packages: [
        {
          platform: "darwin-aarch64",
          immutable_locator:
            "https://downloads.invalid.example/desktop/stable/Proliferate_0.3.38_aarch64.app.tar.gz",
          sha256: sha("a"),
          signature_locator:
            "https://downloads.invalid.example/desktop/stable/Proliferate_0.3.38_aarch64.app.tar.gz.sig",
          sha256_signature: sha("b"),
        },
        {
          platform: "darwin-x86_64",
          immutable_locator:
            "https://downloads.invalid.example/desktop/stable/Proliferate_0.3.38_x64.app.tar.gz",
          sha256: sha("c"),
          signature_locator:
            "https://downloads.invalid.example/desktop/stable/Proliferate_0.3.38_x64.app.tar.gz.sig",
          sha256_signature: sha("d"),
        },
      ],
      updater_pubkey: "dW50cnVzdGVk",
      embedded_anyharness_version: "0.3.38",
    },
    managed_runtime: {
      template_family: "pablo-5391/proliferate-runtime-cloud",
      immutable_template_id: "y7dakz4fs16tbz8vb9zo",
      template_build_id: "661a9621-78db-4c55-84d1-281c21fb72dc",
      source_tag: "sha-e61afc274593",
      input_hash: null,
      anyharness_version: anyharnessVersion,
      worker_version: "0.3.38",
      supervisor_version: "0.3.38",
      harness_catalog_digest: sha("catalog"),
      harness_registry_digest: sha("registry"),
    },
    self_host: {
      version: "0.3.35",
      release_tag: "server-v0.3.35",
      deploy_bundle_locator:
        "https://github.invalid.example/releases/download/server-v0.3.35/proliferate-deploy.tar.gz",
      deploy_bundle_sha256: sha("bundle"),
      server_image_digest: `ghcr.io/proliferate-ai/proliferate-server@sha256:${sha("image")}`,
    },
  };
}

function sealReceipt(body: Omit<RetainedReleaseReceiptV1, "artifact_set_digest">): RetainedReleaseReceiptV1 {
  return { ...body, artifact_set_digest: computeArtifactSetDigest(body) };
}

interface SealRun {
  status: number;
  stderr: string;
}

function runSeal(indexPath: string, draftPath: string): SealRun {
  try {
    execFileSync(TSX, [CLI, "seal", "--input", draftPath, "--index", indexPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    return { status: failure.status ?? -1, stderr: failure.stderr ?? "" };
  }
}

function seedStore(): { dir: string; indexPath: string; receiptPath: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "retained-seal-cli-"));
  const indexPath = path.join(dir, "index.json");
  const receiptPath = path.join(dir, "v0.3.38.json");
  const receipt = sealReceipt(receiptBody());
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
  writeFileSync(receiptPath, receiptText);
  writeFileSync(
    indexPath,
    `${JSON.stringify(
      {
        schema_version: 1,
        kind: "proliferate.retained-release-index",
        receipts: [
          {
            release_id: "v0.3.38",
            source_sha: SHA,
            qualification_state: "bootstrap_unqualified",
            receipt_path: "v0.3.38.json",
            receipt_sha256: sha(receiptText),
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  return { dir, indexPath, receiptPath };
}

test("RR-CONTROL-001: a differing reseal exits 2 and leaves receipt AND index byte-identical", () => {
  const { dir, indexPath, receiptPath } = seedStore();
  const receiptBefore = readFileSync(receiptPath, "utf8");
  const indexBefore = readFileSync(indexPath, "utf8");

  // A changed draft for the same release: different component version.
  const draftPath = path.join(dir, "draft.json");
  writeFileSync(draftPath, JSON.stringify(receiptBody("0.3.39")));

  const result = runSeal(indexPath, draftPath);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /immutable once indexed/);
  assert.match(result.stderr, /Nothing was written/);
  assert.equal(readFileSync(receiptPath, "utf8"), receiptBefore, "receipt bytes must be untouched");
  assert.equal(readFileSync(indexPath, "utf8"), indexBefore, "index bytes must be untouched");
});

test("RR-CONTROL-002: a corrupt index aborts seal before any write (no empty-index reinit)", () => {
  const { dir, indexPath, receiptPath } = seedStore();
  const receiptBefore = readFileSync(receiptPath, "utf8");
  writeFileSync(indexPath, "not json {");

  const draftPath = path.join(dir, "draft.json");
  writeFileSync(draftPath, JSON.stringify(receiptBody()));

  const result = runSeal(indexPath, draftPath);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not valid JSON/);
  assert.equal(readFileSync(indexPath, "utf8"), "not json {", "corrupt index must not be replaced");
  assert.equal(readFileSync(receiptPath, "utf8"), receiptBefore, "receipt bytes must be untouched");
});

test("RR-CONTROL-002: an unsupported index schema aborts seal without writes", () => {
  const { dir, indexPath } = seedStore();
  writeFileSync(
    indexPath,
    JSON.stringify({ schema_version: 99, kind: "proliferate.retained-release-index", receipts: [] }),
  );
  const indexBefore = readFileSync(indexPath, "utf8");
  const draftPath = path.join(dir, "draft.json");
  writeFileSync(draftPath, JSON.stringify(receiptBody()));

  const result = runSeal(indexPath, draftPath);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unsupported/);
  assert.equal(readFileSync(indexPath, "utf8"), indexBefore);
});
