import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseRetainedProductionManifest, loadRetainedProductionManifest } from "./retained-manifest.js";
import { ManifestValidationError } from "./errors.js";
import { validRetainedManifest } from "./test-fixtures.js";

test("a well-formed retained-production manifest parses cleanly", () => {
  const manifest = parseRetainedProductionManifest(validRetainedManifest());
  assert.equal(manifest.kind, "retained-production");
  assert.equal(manifest.productVersion, "0.2.15");
});

test("rejects wrong kind (mistaking a candidate manifest for a retained one)", () => {
  const bad = { ...validRetainedManifest(), kind: "candidate" };
  assert.throws(() => parseRetainedProductionManifest(bad), ManifestValidationError);
});

test("rejects a non-semver productVersion", () => {
  const bad = { ...validRetainedManifest(), productVersion: "vNext" };
  try {
    parseRetainedProductionManifest(bad);
    assert.fail("expected ManifestValidationError");
  } catch (error) {
    assert.ok(error instanceof ManifestValidationError);
    assert.ok(error.issues.some((i) => i.path === "productVersion"));
  }
});

test("requires a non-empty qualificationEvidenceRef", () => {
  const bad = { ...validRetainedManifest(), qualificationEvidenceRef: "" };
  assert.throws(() => parseRetainedProductionManifest(bad), ManifestValidationError);
});

test("rejects a rolling-reference retained e2b template id", () => {
  const bad = { ...validRetainedManifest(), e2bTemplate: { available: true, value: { templateId: "latest", inputHash: "b".repeat(32) } } };
  assert.throws(() => parseRetainedProductionManifest(bad), ManifestValidationError);
});

test("rejects installedAgentPins entries that are not strings", () => {
  const bad = {
    ...validRetainedManifest(),
    installedAgentPins: { available: true, value: { "claude-code": 123 } },
  };
  assert.throws(() => parseRetainedProductionManifest(bad), ManifestValidationError);
});

test("loadRetainedProductionManifest reads an explicit path, never inferring N-1", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "retained-manifest-"));
  try {
    const file = path.join(dir, "retained-n-1.json");
    await writeFile(file, JSON.stringify(validRetainedManifest()), "utf8");
    const manifest = await loadRetainedProductionManifest(file);
    assert.equal(manifest.productVersion, "0.2.15");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadRetainedProductionManifest throws when the file does not exist (no silent N-1 fallback)", async () => {
  await assert.rejects(loadRetainedProductionManifest("/nonexistent/path/retained.json"));
});
