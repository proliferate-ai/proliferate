import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  assertImmutableLocator,
  assertIndexReceiptsBound,
  computeArtifactSetDigest,
  loadIndexedRetainedReceipt,
  loadRetainedReleaseIndex,
  loadRetainedReleaseIndexOrInit,
  loadRetainedReleaseReceipt,
  qualifiedReceiptExists,
  RetainedReleaseError,
  toRetainedReleaseEvidence,
  validateRetainedRelease,
  validateRetainedReleaseReceiptShape,
  verifyRetainedReleaseLive,
  type RetainedReleaseReceiptV1,
} from "./retained-release-set.js";

const SHA = "e61afc274593085e51870b24269f718a543b88b4";
const HEX64 = (seed: string) => createHash("sha256").update(seed).digest("hex");

/** A complete valid receipt body (digest filled in by seal()). */
function validBody(): Omit<RetainedReleaseReceiptV1, "artifact_set_digest"> {
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
            "https://downloads.proliferate.com/desktop/stable/Proliferate_0.3.38_aarch64.app.tar.gz",
          sha256: HEX64("aarch64"),
          signature_locator:
            "https://downloads.proliferate.com/desktop/stable/Proliferate_0.3.38_aarch64.app.tar.gz.sig",
          sha256_signature: HEX64("aarch64.sig"),
        },
        {
          platform: "darwin-x86_64",
          immutable_locator:
            "https://downloads.proliferate.com/desktop/stable/Proliferate_0.3.38_x64.app.tar.gz",
          sha256: HEX64("x64"),
          signature_locator:
            "https://downloads.proliferate.com/desktop/stable/Proliferate_0.3.38_x64.app.tar.gz.sig",
          sha256_signature: HEX64("x64.sig"),
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
      anyharness_version: "0.3.38",
      worker_version: "0.3.38",
      supervisor_version: "0.3.38",
      harness_catalog_digest: HEX64("catalog"),
      harness_registry_digest: HEX64("registry"),
    },
    self_host: {
      version: "0.3.35",
      release_tag: "server-v0.3.35",
      deploy_bundle_locator:
        "https://github.com/proliferate-ai/proliferate/releases/download/server-v0.3.35/proliferate-deploy.tar.gz",
      deploy_bundle_sha256: HEX64("bundle"),
      server_image_digest: `ghcr.io/proliferate-ai/proliferate-server@sha256:${HEX64("image")}`,
    },
  };
}

function seal(body: Omit<RetainedReleaseReceiptV1, "artifact_set_digest">): RetainedReleaseReceiptV1 {
  return { ...body, artifact_set_digest: computeArtifactSetDigest(body) };
}

function mutated(
  mutate: (receipt: RetainedReleaseReceiptV1) => void,
  reseal = false,
): RetainedReleaseReceiptV1 {
  const receipt = seal(validBody());
  mutate(receipt);
  if (reseal) {
    const { artifact_set_digest: _ignored, ...body } = receipt;
    return seal(body);
  }
  return receipt;
}

test("accepts a complete valid receipt", () => {
  const receipt = validateRetainedReleaseReceiptShape(seal(validBody()));
  assert.equal(receipt.release.release_id, "v0.3.38");
  assert.equal(receipt.managed_runtime.source_tag, "sha-e61afc274593");
});

test("rejects an unknown schema version", () => {
  assert.throws(
    () => validateRetainedReleaseReceiptShape(mutated((r) => ((r as { schema_version: number }).schema_version = 2), true)),
    (error: unknown) => error instanceof RetainedReleaseError && /schema_version/.test((error as Error).message),
  );
});

test("rejects each required target block missing independently", () => {
  for (const key of ["desktop", "managed_runtime", "self_host", "release"] as const) {
    const receipt = seal(validBody()) as unknown as Record<string, unknown>;
    delete receipt[key];
    assert.throws(
      () => validateRetainedReleaseReceiptShape(receipt),
      RetainedReleaseError,
      `expected removal of ${key} to reject`,
    );
  }
});

test("rejects a missing supported desktop platform", () => {
  assert.throws(
    () => validateRetainedReleaseReceiptShape(mutated((r) => void r.desktop.packages.pop(), true)),
    /missing supported platform/,
  );
});

test("rejects undeclared fields", () => {
  const receipt = seal(validBody()) as unknown as Record<string, unknown>;
  receipt.rider = "smuggled";
  assert.throws(() => validateRetainedReleaseReceiptShape(receipt), /undeclared field/);
});

test("rejects mutable-alias locators even though they currently resolve", () => {
  assert.throws(
    () =>
      validateRetainedReleaseReceiptShape(
        mutated(
          (r) =>
            (r.desktop.packages[0].immutable_locator =
              "https://downloads.proliferate.com/desktop/stable/latest.json"),
          true,
        ),
      ),
    /mutable alias/,
  );
});

test("rejects expiring presigned locators", () => {
  assert.throws(
    () =>
      validateRetainedReleaseReceiptShape(
        mutated(
          (r) =>
            (r.self_host.deploy_bundle_locator =
              "https://bucket.s3.amazonaws.com/proliferate-deploy-0.3.35.tar.gz?X-Amz-Signature=abc&X-Amz-Expires=300"),
          true,
        ),
      ),
    /expiring/i,
  );
});

test("rejects local filesystem paths in a persisted receipt", () => {
  assert.throws(
    () => assertImmutableLocator("/tmp/proliferate-deploy.tar.gz", "self_host.deploy_bundle", ["0.3.35"]),
    /local filesystem path/,
  );
  assert.throws(
    () => assertImmutableLocator("file:///tmp/x-0.3.35.tar.gz", "self_host.deploy_bundle", ["0.3.35"]),
    /local filesystem path/,
  );
});

test("rejects a locator with no content identity", () => {
  assert.throws(
    () => assertImmutableLocator("https://example.com/downloads/app.tar.gz", "desktop", ["0.3.38", "e61afc274593"]),
    /no content identity/,
  );
});

test("rejects a mutable-tag-only server image reference", () => {
  assert.throws(
    () =>
      validateRetainedReleaseReceiptShape(
        mutated((r) => (r.self_host.server_image_digest = "ghcr.io/proliferate-ai/proliferate-server:0.3.35"), true),
      ),
    /pinned by @sha256/,
  );
});

test("rejects artifact-set digest drift", () => {
  assert.throws(
    () =>
      validateRetainedReleaseReceiptShape(
        mutated((r) => (r.managed_runtime.anyharness_version = "0.3.39"), false),
      ),
    /artifact_set_digest does not recompute/,
  );
});

test("rejects a source tag inconsistent with the source SHA", () => {
  assert.throws(
    () =>
      validateRetainedReleaseReceiptShape(
        mutated((r) => (r.managed_runtime.source_tag = "sha-aaaaaaaaaaaa"), true),
      ),
    /does not match the release source SHA/,
  );
});

test("rejects a null input hash on a qualified receipt, allows it on bootstrap", () => {
  const qualified = mutated((r) => {
    r.release.qualification_state = "qualified";
    r.release.qualification_evidence = {
      report_sha256: HEX64("report"),
      immutable_locator: `https://qualification.example.com/evidence/v0.3.38/${HEX64("report")}.json`,
    };
  }, true);
  assert.throws(
    () => validateRetainedReleaseReceiptShape(qualified),
    /input hash/,
  );
  // bootstrap with null input hash is the valid fixture itself
  assert.equal(validateRetainedReleaseReceiptShape(seal(validBody())).managed_runtime.input_hash, null);
});

test("rejects qualification evidence on a bootstrap receipt (no retrofitted history)", () => {
  assert.throws(
    () =>
      validateRetainedReleaseReceiptShape(
        mutated((r) => {
          r.release.qualification_evidence = {
            report_sha256: HEX64("fake"),
            immutable_locator: `https://example.com/evidence/v0.3.38/${HEX64("fake")}.json`,
          };
        }, true),
      ),
    /retrofit/,
  );
});

test("requires evidence on a qualified receipt", () => {
  assert.throws(
    () =>
      validateRetainedReleaseReceiptShape(
        mutated((r) => {
          r.release.qualification_state = "qualified";
          r.managed_runtime.input_hash = HEX64("input");
        }, true),
      ),
    /qualification_evidence/,
  );
});

test("bootstrap policy: bootstrap receipt fails closed once a qualified receipt exists", () => {
  const receipt = validateRetainedReleaseReceiptShape(seal(validBody()));
  validateRetainedRelease(receipt, { requiredTargets: ["managed-runtime"], qualifiedReceiptExists: false });
  assert.throws(
    () =>
      validateRetainedRelease(receipt, {
        requiredTargets: ["managed-runtime"],
        qualifiedReceiptExists: true,
      }),
    /bootstrap exception no longer applies/,
  );
});

test("policy: N-1 must not equal candidate N", () => {
  const receipt = validateRetainedReleaseReceiptShape(seal(validBody()));
  assert.throws(
    () =>
      validateRetainedRelease(receipt, {
        requiredTargets: ["desktop"],
        currentCandidateSourceSha: SHA,
        qualifiedReceiptExists: false,
      }),
    /same source SHA as candidate N/,
  );
});

test("live verification detects template build and OCI digest drift", async () => {
  const receipt = validateRetainedReleaseReceiptShape(seal(validBody()));
  await verifyRetainedReleaseLive(receipt, {
    resolveE2bTags: async () => [
      { tag: "sha-e61afc274593", buildId: "661a9621-78db-4c55-84d1-281c21fb72dc" },
      { tag: "production", buildId: "somewhere-else" },
    ],
  });
  await assert.rejects(
    verifyRetainedReleaseLive(receipt, {
      resolveE2bTags: async () => [{ tag: "sha-e61afc274593", buildId: "different-build" }],
    }),
    /template build drift/,
  );
  await assert.rejects(
    verifyRetainedReleaseLive(receipt, {
      resolveE2bTags: async () => [],
    }),
    /no longer resolves/,
  );
  await assert.rejects(
    verifyRetainedReleaseLive(receipt, {
      resolveOciDigest: async () => `sha256:${HEX64("other-image")}`,
    }),
    /image digest drift/,
  );
});

test("live verification detects component version/catalog drift", async () => {
  const receipt = validateRetainedReleaseReceiptShape(seal(validBody()));
  await assert.rejects(
    verifyRetainedReleaseLive(receipt, {
      expectedComponents: { anyharness_version: "0.1.0" },
    }),
    /component drift on managed_runtime.anyharness_version/,
  );
  await assert.rejects(
    verifyRetainedReleaseLive(receipt, {
      expectedComponents: { harness_catalog_digest: HEX64("other-catalog") },
    }),
    /component drift on managed_runtime.harness_catalog_digest/,
  );
});

test("live verification detects E2B input-hash drift when a hash is recorded", async () => {
  const receipt = validateRetainedReleaseReceiptShape(
    mutated((r) => (r.managed_runtime.input_hash = HEX64("input")), true),
  );
  await assert.rejects(
    verifyRetainedReleaseLive(receipt, {
      resolveE2bInputHash: async () => HEX64("drifted-input"),
    }),
    /input hash drift/,
  );
});

test("evidence projection is bounded to identities and hashes", () => {
  const receipt = validateRetainedReleaseReceiptShape(seal(validBody()));
  const evidence = toRetainedReleaseEvidence(receipt, HEX64("receipt-bytes"), ["desktop"], [
    { artifact: "desktop/darwin-aarch64/package", digest: HEX64("aarch64") },
  ]);
  assert.deepEqual(Object.keys(evidence).sort(), [
    "artifact_set_digest",
    "kind",
    "materialized_hashes",
    "qualification_state",
    "receipt_sha256",
    "release_id",
    "selected_targets",
    "source_sha",
  ]);
  const serialized = JSON.stringify(evidence);
  assert.ok(!serialized.includes("https://"), "evidence must not carry raw locators");
  assert.ok(!serialized.includes("updater_pubkey"), "evidence must not embed receipt bodies");
});

test("RR-CONTROL-002: a malformed index fails closed, never an empty init", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "retained-index-corrupt-"));
  const indexPath = path.join(dir, "index.json");
  writeFileSync(indexPath, "not json {");
  assert.throws(() => loadRetainedReleaseIndex(indexPath), /not valid JSON/);
  assert.throws(() => loadRetainedReleaseIndexOrInit(indexPath), /not valid JSON/);
  writeFileSync(indexPath, JSON.stringify({ schema_version: 99, kind: "proliferate.retained-release-index", receipts: [] }));
  assert.throws(() => loadRetainedReleaseIndexOrInit(indexPath), /Unsupported/);
  // Only a genuinely ABSENT file initializes empty.
  const absent = loadRetainedReleaseIndexOrInit(path.join(dir, "does-not-exist.json"));
  assert.deepEqual(absent.receipts, []);
});

test("RR-CONTROL-005: duplicate release ids and traversal paths reject at index load", () => {
  const entry = {
    release_id: "v0.3.38",
    source_sha: SHA,
    qualification_state: "bootstrap_unqualified",
    receipt_path: "v0.3.38.json",
    receipt_sha256: HEX64("bytes"),
  };
  const dir = mkdtempSync(path.join(os.tmpdir(), "retained-index-dup-"));
  const indexPath = path.join(dir, "index.json");
  writeFileSync(
    indexPath,
    JSON.stringify({ schema_version: 1, kind: "proliferate.retained-release-index", receipts: [entry, entry] }),
  );
  assert.throws(() => loadRetainedReleaseIndex(indexPath), /duplicate release_id/);
  writeFileSync(
    indexPath,
    JSON.stringify({
      schema_version: 1,
      kind: "proliferate.retained-release-index",
      receipts: [{ ...entry, receipt_path: "../escape/v0.3.38.json" }],
    }),
  );
  assert.throws(() => loadRetainedReleaseIndex(indexPath), /must stay inside/);
  writeFileSync(
    indexPath,
    JSON.stringify({
      schema_version: 1,
      kind: "proliferate.retained-release-index",
      receipts: [{ ...entry, receipt_path: "/abs/v0.3.38.json" }],
    }),
  );
  assert.throws(() => loadRetainedReleaseIndex(indexPath), /must stay inside/);
});

test("RR-CONTROL-005: index entry identity/state must match the loaded receipt", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "retained-index-bind-"));
  const indexPath = path.join(dir, "index.json");
  const receipt = seal(validBody());
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
  writeFileSync(path.join(dir, "v0.3.38.json"), receiptText);
  const receiptSha = createHash("sha256").update(receiptText, "utf8").digest("hex");
  // Correct bytes, lying source_sha in the entry.
  writeFileSync(
    indexPath,
    JSON.stringify({
      schema_version: 1,
      kind: "proliferate.retained-release-index",
      receipts: [
        {
          release_id: "v0.3.38",
          source_sha: "b".repeat(40),
          qualification_state: "bootstrap_unqualified",
          receipt_path: "v0.3.38.json",
          receipt_sha256: receiptSha,
        },
      ],
    }),
  );
  const lyingIndex = loadRetainedReleaseIndex(indexPath);
  assert.throws(
    () => loadIndexedRetainedReceipt(lyingIndex, indexPath, "v0.3.38"),
    /does not match the receipt it points at/,
  );
  assert.throws(() => assertIndexReceiptsBound(lyingIndex, indexPath), /does not match the receipt/);
  // Honest entry binds cleanly.
  writeFileSync(
    indexPath,
    JSON.stringify({
      schema_version: 1,
      kind: "proliferate.retained-release-index",
      receipts: [
        {
          release_id: "v0.3.38",
          source_sha: SHA,
          qualification_state: "bootstrap_unqualified",
          receipt_path: "v0.3.38.json",
          receipt_sha256: receiptSha,
        },
      ],
    }),
  );
  const honest = loadRetainedReleaseIndex(indexPath);
  assertIndexReceiptsBound(honest, indexPath);
  const loaded = loadIndexedRetainedReceipt(honest, indexPath, "v0.3.38");
  assert.equal(loaded.receipt.release.release_id, "v0.3.38");
});

test("index loads, round-trips, and drives qualifiedReceiptExists", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "retained-index-"));
  const indexPath = path.join(dir, "index.json");
  const receipt = seal(validBody());
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
  writeFileSync(path.join(dir, "v0.3.38.json"), receiptText);
  writeFileSync(
    indexPath,
    JSON.stringify({
      schema_version: 1,
      kind: "proliferate.retained-release-index",
      receipts: [
        {
          release_id: "v0.3.38",
          source_sha: SHA,
          qualification_state: "bootstrap_unqualified",
          receipt_path: "v0.3.38.json",
          receipt_sha256: createHash("sha256").update(receiptText, "utf8").digest("hex"),
        },
      ],
    }),
  );
  const index = loadRetainedReleaseIndex(indexPath);
  assert.equal(qualifiedReceiptExists(index), false);
  const loaded = loadRetainedReleaseReceipt(path.join(dir, "v0.3.38.json"));
  assert.equal(loaded.receiptSha256, index.receipts[0].receipt_sha256);
});
