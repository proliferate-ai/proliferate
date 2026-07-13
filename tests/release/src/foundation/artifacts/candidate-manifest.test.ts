import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseCandidateManifest, loadCandidateManifest } from "./candidate-manifest.js";
import { ManifestValidationError } from "./errors.js";
import { slotValue, validCandidateManifest } from "./test-fixtures.js";

test("a well-formed candidate manifest parses cleanly", () => {
  const manifest = parseCandidateManifest(validCandidateManifest());
  assert.equal(manifest.kind, "candidate");
  assert.equal(manifest.sourceSha, "9f2c1e7abc1234567890abcdef1234567890abcd");
});

test("rejects a non-object payload", () => {
  assert.throws(() => parseCandidateManifest("not-an-object"), ManifestValidationError);
  assert.throws(() => parseCandidateManifest(null), ManifestValidationError);
});

test("rejects wrong schemaVersion/kind", () => {
  const bad = { ...validCandidateManifest(), schemaVersion: 2, kind: "retained-production" };
  try {
    parseCandidateManifest(bad);
    assert.fail("expected ManifestValidationError");
  } catch (error) {
    assert.ok(error instanceof ManifestValidationError);
    const paths = error.issues.map((i) => i.path);
    assert.ok(paths.includes("schemaVersion"));
    assert.ok(paths.includes("kind"));
  }
});

test("rejects a rolling-reference locator in a scalar slot", () => {
  const manifest = validCandidateManifest();
  const serverImageValue = slotValue(manifest.serverImage);
  const bad = {
    ...manifest,
    serverImage: { available: true, value: { ...serverImageValue, locator: "s3://bucket/candidate/latest" } },
  };
  try {
    parseCandidateManifest(bad);
    assert.fail("expected ManifestValidationError");
  } catch (error) {
    assert.ok(error instanceof ManifestValidationError);
    assert.ok(error.issues.some((i) => i.path === "serverImage.value.locator" && /rolling reference/.test(i.message)));
  }
});

test("rejects a rolling-reference template id", () => {
  const manifest = validCandidateManifest();
  const bad = { ...manifest, e2bTemplate: { available: true, value: { templateId: "stable", inputHash: "b".repeat(32) } } };
  assert.throws(() => parseCandidateManifest(bad), (error: unknown) => {
    assert.ok(error instanceof ManifestValidationError);
    return error.issues.some((i) => i.path === "e2bTemplate.value.templateId");
  });
});

test("rejects a missing digest on an available slot", () => {
  const manifest = validCandidateManifest();
  const value = slotValue(manifest.webBuild);
  const bad = { ...manifest, webBuild: { available: true, value: { ...value, digest: "" } } };
  try {
    parseCandidateManifest(bad);
    assert.fail("expected ManifestValidationError");
  } catch (error) {
    assert.ok(error instanceof ManifestValidationError);
    assert.ok(error.issues.some((i) => i.path === "webBuild.value.digest"));
  }
});

test("rejects a malformed (non-hex) digest on an available slot", () => {
  const manifest = validCandidateManifest();
  const value = slotValue(manifest.webBuild);
  const bad = { ...manifest, webBuild: { available: true, value: { ...value, digest: "not-hex" } } };
  assert.throws(() => parseCandidateManifest(bad), ManifestValidationError);
});

test("accepts an explicitly unavailable slot with a reason, and rejects one without a reason", () => {
  const manifest = validCandidateManifest();
  assert.doesNotThrow(() =>
    parseCandidateManifest({ ...manifest, desktopApp: { available: false, reason: "not built" } }),
  );
  assert.throws(
    () => parseCandidateManifest({ ...manifest, desktopApp: { available: false, reason: "" } }),
    ManifestValidationError,
  );
});

test("rejects an unrecognized platform key in a per-platform slot map", () => {
  const manifest = validCandidateManifest();
  const bad = {
    ...manifest,
    anyharness: { "windows-x86_64": { available: true, value: (manifest.anyharness as any)["darwin-aarch64"].value } },
  };
  assert.throws(() => parseCandidateManifest(bad), ManifestValidationError);
});

test("collects multiple issues in one pass rather than stopping at the first", () => {
  const manifest = validCandidateManifest();
  const bad = { ...manifest, schemaVersion: 2, sourceSha: "" };
  try {
    parseCandidateManifest(bad);
    assert.fail("expected ManifestValidationError");
  } catch (error) {
    assert.ok(error instanceof ManifestValidationError);
    assert.ok(error.issues.length >= 2);
  }
});

test("loadCandidateManifest reads and validates a JSON file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "candidate-manifest-"));
  try {
    const file = path.join(dir, "candidate-manifest.json");
    await writeFile(file, JSON.stringify(validCandidateManifest()), "utf8");
    const manifest = await loadCandidateManifest(file);
    assert.equal(manifest.kind, "candidate");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadCandidateManifest throws a typed error on malformed JSON", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "candidate-manifest-"));
  try {
    const file = path.join(dir, "candidate-manifest.json");
    await writeFile(file, "{not json", "utf8");
    await assert.rejects(loadCandidateManifest(file), ManifestValidationError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
