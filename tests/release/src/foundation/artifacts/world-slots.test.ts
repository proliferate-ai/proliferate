import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertCandidateWorldSlotsAvailable,
  assertRetainedWorldSlotsAvailable,
  candidateRequirementsForWorld,
} from "./world-slots.js";
import { validCandidateManifest, validRetainedManifest, withUnavailableSlot } from "./test-fixtures.js";

test("a fully-populated candidate manifest satisfies local-runtime's required slots", () => {
  const report = assertCandidateWorldSlotsAvailable(["local-runtime"], validCandidateManifest(), [
    "darwin-aarch64",
  ]);
  assert.equal(report.complete, true);
  assert.deepEqual(report.missing, []);
});

test("tier-2 never requires any candidate-manifest slot", () => {
  const report = assertCandidateWorldSlotsAvailable(["tier-2"], validCandidateManifest(), []);
  assert.equal(report.complete, true);
});

test("flags an unavailable required scalar slot", () => {
  const manifest = validCandidateManifest();
  const mutated = withUnavailableSlot(manifest, "serverImage", "not built");
  const report = assertCandidateWorldSlotsAvailable(["managed-cloud"], mutated, ["linux-x86_64"]);
  assert.equal(report.complete, false);
  assert.ok(report.missing.some((m) => m.slot === "serverImage" && m.world === "managed-cloud"));
});

test("flags a missing per-platform slot for the requested platform", () => {
  const manifest = validCandidateManifest();
  // The fixture only has an anyharness build for darwin-aarch64.
  const report = assertCandidateWorldSlotsAvailable(["local-runtime"], manifest, ["linux-x86_64"]);
  assert.equal(report.complete, false);
  assert.ok(report.missing.some((m) => m.slot === "anyharness" && m.platform === "linux-x86_64"));
});

test("a required per-platform slot with no platform supplied is reported missing, not skipped", () => {
  const manifest = validCandidateManifest();
  const report = assertCandidateWorldSlotsAvailable(["managed-cloud"], manifest, []);
  assert.equal(report.complete, false);
  assert.ok(report.missing.some((m) => m.slot === "worker" && m.platform === null));
});

test("conditional slots are not enforced by default", () => {
  const manifest = withUnavailableSlot(validCandidateManifest(), "litellm", "reusing standing gateway");
  const report = assertCandidateWorldSlotsAvailable(["local-runtime"], manifest, ["darwin-aarch64"]);
  assert.equal(report.complete, true);
});

test("conditional slots ARE enforced when includeConditional is set", () => {
  const manifest = withUnavailableSlot(validCandidateManifest(), "litellm", "reusing standing gateway");
  const report = assertCandidateWorldSlotsAvailable(["local-runtime"], manifest, ["darwin-aarch64"], {
    includeConditional: true,
  });
  assert.equal(report.complete, false);
  assert.ok(report.missing.some((m) => m.slot === "litellm"));
});

test("checking multiple worlds at once reports every world's gaps", () => {
  const manifest = validCandidateManifest();
  const report = assertCandidateWorldSlotsAvailable(["local-runtime", "managed-cloud"], manifest, [
    "darwin-aarch64",
  ]);
  // local-runtime is satisfied on darwin-aarch64; managed-cloud needs
  // worker/supervisor which the fixture only has for linux-x86_64, so it
  // still needs anyharness on darwin-aarch64 too (fixture has it) but is
  // missing worker/supervisor for darwin-aarch64.
  assert.equal(report.complete, false);
  assert.ok(report.missing.every((m) => m.world === "managed-cloud"));
});

test("candidateRequirementsForWorld throws for an unencoded world id", () => {
  assert.throws(() => candidateRequirementsForWorld("not-a-world" as never));
});

test("retained-manifest completeness: desktop-upgrade requires the N-1 desktop/agent slots", () => {
  const report = assertRetainedWorldSlotsAvailable(["desktop-upgrade"], validRetainedManifest());
  assert.equal(report.complete, true);
});

test("retained-manifest completeness flags a missing installedAgentPins slot", () => {
  const manifest = withUnavailableSlot(validRetainedManifest(), "installedAgentPins", "not captured");
  const report = assertRetainedWorldSlotsAvailable(["desktop-upgrade"], manifest);
  assert.equal(report.complete, false);
  assert.ok(report.missing.some((m) => m.slot === "installedAgentPins"));
});

test("worlds without a Tier 4 retained dependency are trivially complete", () => {
  const report = assertRetainedWorldSlotsAvailable(["tier-2", "managed-cloud"], validRetainedManifest());
  assert.equal(report.complete, true);
  assert.deepEqual(report.missing, []);
});
