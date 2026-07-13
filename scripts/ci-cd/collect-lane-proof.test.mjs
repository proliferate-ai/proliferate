import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  canonicalizeReferences,
  collectLaneProof,
  computeArtifactSetDigest,
  loadLaneMatrix,
  providerForLane,
  requiredLanesFor,
} from "./collect-lane-proof.mjs";

const OCI_A = "proliferate-server@sha256:" + "a".repeat(64);
const OCI_B = "proliferate-server@sha256:" + "b".repeat(64);

test("matrix matches the contract table exactly", () => {
  const matrix = loadLaneMatrix();
  assert.deepEqual(requiredLanesFor("proliferate-server", matrix), [
    "hosted-server",
    "self-hosted-release",
  ]);
  assert.deepEqual(requiredLanesFor("anyharness", matrix), [
    "desktop-updater",
    "e2b-production",
    "runtime-artifacts",
    "self-hosted-release",
  ]);
  assert.deepEqual(requiredLanesFor("proliferate-worker", matrix), [
    "e2b-production",
    "runtime-artifacts",
    "self-hosted-release",
  ]);
  // The disabled hosted `workers` surface is not a v1 production lane.
  assert.equal(matrix.components["proliferate-workers"], undefined);
  assert.equal(matrix.lanes["hosted-workers"], undefined);
});

test("digest is byte-deterministic and order-independent (fixture)", () => {
  const forward = computeArtifactSetDigest("oci", [OCI_A, OCI_B]);
  const reversed = computeArtifactSetDigest("oci", [OCI_B, OCI_A]);
  assert.equal(forward, reversed);

  // Exact expected bytes: sha256 over the canonical sorted JSON array.
  const expected = createHash("sha256")
    .update(JSON.stringify([OCI_A.toLowerCase(), OCI_B.toLowerCase()].sort()))
    .digest("hex");
  assert.equal(forward, expected);
  assert.match(forward, /^[0-9a-f]{64}$/);
});

test("OCI references are lowercased and require a pinned digest", () => {
  const upper = "Repo@SHA256:" + "A".repeat(64);
  const [normalized] = canonicalizeReferences("oci", [upper]);
  assert.equal(normalized, upper.toLowerCase());
  assert.throws(() => canonicalizeReferences("oci", ["repo:latest"]), /pinned sha256 digest/);
});

test("checksum references accept name-prefixed and bare 64-hex", () => {
  const digest = "c".repeat(64);
  assert.deepEqual(canonicalizeReferences("checksum", [`anyharness.tar.gz:${digest}`]), [
    `anyharness.tar.gz:${digest}`,
  ]);
  assert.deepEqual(canonicalizeReferences("checksum", [digest]), [digest]);
  assert.throws(() => canonicalizeReferences("checksum", ["not-a-hash"]), /published SHA-256/);
});

test("opaque provider ids (vercel/eas/e2b) keep case and reject whitespace", () => {
  assert.deepEqual(canonicalizeReferences("vercel", ["dpl_ABC123"]), ["dpl_ABC123"]);
  assert.deepEqual(canonicalizeReferences("eas", ["b1e2-UUID"]), ["b1e2-UUID"]);
  assert.throws(() => canonicalizeReferences("e2b", ["has space"]), /whitespace/);
});

test("duplicate references are rejected", () => {
  assert.throws(() => canonicalizeReferences("oci", [OCI_A, OCI_A]), /Duplicate/);
});

test("empty reference set is rejected", () => {
  assert.throws(() => canonicalizeReferences("oci", []), /At least one/);
});

test("collectLaneProof resolves provider from the matrix", () => {
  const proof = collectLaneProof({ lane: "hosted-web", references: ["dpl_live_deployment"] });
  assert.equal(proof.provider, "vercel");
  assert.equal(proof.lane, "hosted-web");
  assert.deepEqual(proof.references, ["dpl_live_deployment"]);
  assert.equal(proof.artifactSetDigest, computeArtifactSetDigest("vercel", ["dpl_live_deployment"]));
});

test("providerForLane rejects an unknown lane", () => {
  assert.throws(() => providerForLane("made-up-lane"), /Unknown production lane/);
});
