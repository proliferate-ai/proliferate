import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { EnvResolution } from "../config/env-resolution.js";
import {
  computeArtifactSetDigest,
  RetainedReleaseError,
  type RetainedReleaseReceiptV1,
} from "../artifacts/retained-release-set.js";
import {
  RETAINED_RELEASE_ID_ENV,
  resolveRetainedRuntimeBaseline,
} from "./retained-runtime-baseline.js";

const SHA = "e61afc274593085e51870b24269f718a543b88b4";
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

function fakeEnv(values: Record<string, string>): EnvResolution {
  return { get: (name: string) => values[name] } as unknown as EnvResolution;
}

function sealedReceipt(
  state: "bootstrap_unqualified" | "qualified" = "bootstrap_unqualified",
): RetainedReleaseReceiptV1 {
  const body: Omit<RetainedReleaseReceiptV1, "artifact_set_digest"> = {
    schema_version: 1,
    kind: "proliferate.retained-release",
    release: {
      release_id: "v0.3.38",
      release_tag: "proliferate-v0.3.38",
      source_sha: SHA,
      published_at: "2026-07-17T01:07:21.493Z",
      qualification_state: state,
      qualification_evidence:
        state === "qualified"
          ? {
              report_sha256: sha("report"),
              immutable_locator: `https://qualification.example.com/evidence/v0.3.38/${sha("report")}.json`,
            }
          : null,
    },
    desktop: {
      version: "0.3.38",
      packages: [
        {
          platform: "darwin-aarch64",
          immutable_locator:
            "https://downloads.proliferate.com/desktop/stable/Proliferate_0.3.38_aarch64.app.tar.gz",
          sha256: sha("a"),
          signature_locator:
            "https://downloads.proliferate.com/desktop/stable/Proliferate_0.3.38_aarch64.app.tar.gz.sig",
          sha256_signature: sha("b"),
        },
        {
          platform: "darwin-x86_64",
          immutable_locator:
            "https://downloads.proliferate.com/desktop/stable/Proliferate_0.3.38_x64.app.tar.gz",
          sha256: sha("c"),
          signature_locator:
            "https://downloads.proliferate.com/desktop/stable/Proliferate_0.3.38_x64.app.tar.gz.sig",
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
      input_hash: state === "qualified" ? sha("input") : null,
      anyharness_version: "0.3.38",
      worker_version: "0.3.38",
      supervisor_version: "0.3.38",
      harness_catalog_digest: sha("catalog"),
      harness_registry_digest: sha("registry"),
    },
    self_host: {
      version: "0.3.35",
      release_tag: "server-v0.3.35",
      deploy_bundle_locator:
        "https://github.com/proliferate-ai/proliferate/releases/download/server-v0.3.35/proliferate-deploy.tar.gz",
      deploy_bundle_sha256: sha("bundle"),
      server_image_digest: `ghcr.io/proliferate-ai/proliferate-server@sha256:${sha("image")}`,
    },
  };
  return { ...body, artifact_set_digest: computeArtifactSetDigest(body) };
}

function writeIndexDir(receipts: RetainedReleaseReceiptV1[]): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "retained-baseline-"));
  const entries = receipts.map((receipt) => {
    const fileName = `${receipt.release.release_id}.json`;
    const text = `${JSON.stringify(receipt, null, 2)}\n`;
    writeFileSync(path.join(dir, fileName), text);
    return {
      release_id: receipt.release.release_id,
      source_sha: receipt.release.source_sha,
      qualification_state: receipt.release.qualification_state,
      receipt_path: fileName,
      receipt_sha256: sha(text),
    };
  });
  writeFileSync(
    path.join(dir, "index.json"),
    JSON.stringify({ schema_version: 1, kind: "proliferate.retained-release-index", receipts: entries }),
  );
  return path.join(dir, "index.json");
}

test("returns null when no baseline input names anything (honest block)", () => {
  assert.equal(resolveRetainedRuntimeBaseline(fakeEnv({})), null);
});

test("resolves a committed receipt by release id with full validation", () => {
  const indexPath = writeIndexDir([sealedReceipt()]);
  const baseline = resolveRetainedRuntimeBaseline(
    fakeEnv({ [RETAINED_RELEASE_ID_ENV]: "v0.3.38" }),
    undefined,
    { indexPath },
  );
  assert.ok(baseline);
  assert.equal(baseline.templateId, "y7dakz4fs16tbz8vb9zo");
  assert.equal(baseline.anyharnessReportedVersion, "0.3.38");
  assert.equal(baseline.receipt?.release.qualification_state, "bootstrap_unqualified");
  assert.ok(baseline.receiptSha256);
  const manifest = JSON.parse(baseline.manifest) as Record<string, unknown>;
  assert.equal(manifest.source_sha, SHA);
  assert.equal(manifest.template_build_id, "661a9621-78db-4c55-84d1-281c21fb72dc");
});

test("a named release id that is not indexed is an error, never a silent block", () => {
  const indexPath = writeIndexDir([sealedReceipt()]);
  assert.throws(
    () =>
      resolveRetainedRuntimeBaseline(fakeEnv({ [RETAINED_RELEASE_ID_ENV]: "v9.9.9" }), undefined, {
        indexPath,
      }),
    RetainedReleaseError,
  );
});

test("receipt bytes that do not match the index reject", () => {
  const receipt = sealedReceipt();
  const indexPath = writeIndexDir([receipt]);
  // Rewrite the receipt file (still shape-valid) without updating the index.
  writeFileSync(
    path.join(path.dirname(indexPath), "v0.3.38.json"),
    `${JSON.stringify(receipt)}\n`,
  );
  assert.throws(
    () =>
      resolveRetainedRuntimeBaseline(fakeEnv({ [RETAINED_RELEASE_ID_ENV]: "v0.3.38" }), undefined, {
        indexPath,
      }),
    /do not match the index/,
  );
});

test("bootstrap receipt fails closed once any qualified receipt is indexed", () => {
  const qualified = sealedReceipt("qualified");
  qualified.release.release_id = "v0.4.0";
  qualified.release.release_tag = "proliferate-v0.4.0";
  const resealBody = { ...qualified } as Record<string, unknown>;
  delete resealBody.artifact_set_digest;
  qualified.artifact_set_digest = computeArtifactSetDigest(
    resealBody as unknown as Omit<RetainedReleaseReceiptV1, "artifact_set_digest">,
  );
  // Its desktop version no longer matches v0.4.0, but the index-level policy
  // check fires on the SELECTED receipt before its file is even loaded when
  // selecting the bootstrap entry, so shape validity of the sibling does not
  // matter for this assertion — keep the sibling only in the index.
  const bootstrap = sealedReceipt();
  const dir = mkdtempSync(path.join(os.tmpdir(), "retained-baseline-mixed-"));
  const bootstrapText = `${JSON.stringify(bootstrap, null, 2)}\n`;
  writeFileSync(path.join(dir, "v0.3.38.json"), bootstrapText);
  writeFileSync(
    path.join(dir, "index.json"),
    JSON.stringify({
      schema_version: 1,
      kind: "proliferate.retained-release-index",
      receipts: [
        {
          release_id: "v0.3.38",
          source_sha: bootstrap.release.source_sha,
          qualification_state: "bootstrap_unqualified",
          receipt_path: "v0.3.38.json",
          receipt_sha256: sha(bootstrapText),
        },
        {
          release_id: "v0.4.0",
          source_sha: "f".repeat(40),
          qualification_state: "qualified",
          receipt_path: "v0.4.0.json",
          receipt_sha256: sha("placeholder"),
        },
      ],
    }),
  );
  assert.throws(
    () =>
      resolveRetainedRuntimeBaseline(fakeEnv({ [RETAINED_RELEASE_ID_ENV]: "v0.3.38" }), undefined, {
        indexPath: path.join(dir, "index.json"),
      }),
    /bootstrap exception no longer applies/,
  );
});

test("a blank release id resolves to null (honest block), whitespace-only included", () => {
  assert.equal(resolveRetainedRuntimeBaseline(fakeEnv({ [RETAINED_RELEASE_ID_ENV]: "   " })), null);
});

test("honors the reported-version override for unstamped binaries (issue #1089)", () => {
  const indexPath = writeIndexDir([sealedReceipt()]);
  const overridden = resolveRetainedRuntimeBaseline(
    fakeEnv({ [RETAINED_RELEASE_ID_ENV]: "v0.3.38" }),
    "0.1.0",
    { indexPath },
  );
  assert.equal(overridden?.anyharnessReportedVersion, "0.1.0");
  const blank = resolveRetainedRuntimeBaseline(
    fakeEnv({ [RETAINED_RELEASE_ID_ENV]: "v0.3.38" }),
    "   ",
    { indexPath },
  );
  assert.equal(blank?.anyharnessReportedVersion, "0.3.38");
});
