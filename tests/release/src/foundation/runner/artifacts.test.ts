import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveManifestHash,
  validateCandidateManifest,
  assertSelectedWorldArtifacts,
  availableCandidateSlots,
  ManifestValidationError,
} from "./artifacts.js";
import { canonicalManifestHash } from "../contracts/hashing.js";
import { candidateManifest, retainedManifest, available, unavailable, locator } from "../fakes/manifests.js";

test("canonical hashing is key-order independent but value-sensitive", () => {
  const a = candidateManifest();
  // Re-key the top level in a different order: same semantic content, same hash.
  const reordered = Object.fromEntries(Object.entries(a).reverse()) as typeof a;
  assert.equal(canonicalManifestHash(a), canonicalManifestHash(reordered));

  const mutated = candidateManifest({ sourceSha: a.sourceSha + "0" });
  assert.notEqual(canonicalManifestHash(a), canonicalManifestHash(mutated));
});

test("resolveManifestHash validates before hashing; a hash of an invalid manifest never exists", () => {
  const good = candidateManifest();
  assert.equal(resolveManifestHash(good), canonicalManifestHash(good));

  // Malformed: wrong kind.
  assert.throws(() => resolveManifestHash({ ...good, kind: "nope" } as never), ManifestValidationError);
});

test("rejects a rolling/mutable locator tag", () => {
  const rolling = candidateManifest({
    serverImage: available(locator({ locator: "ghcr.io/proliferate/server:latest" })),
  });
  assert.throws(() => validateCandidateManifest(rolling), /rolling reference/);

  const rollingSegment = candidateManifest({
    webBuild: available(locator({ locator: "s3://web/stable" })),
  });
  assert.throws(() => validateCandidateManifest(rollingSegment), /rolling reference/);
});

test("rejects a bad digest and a non-sha256 algorithm", () => {
  assert.throws(
    () => validateCandidateManifest(candidateManifest({ serverImage: available(locator({ digest: "short" })) })),
    /sha256 hex/,
  );
  assert.throws(
    () =>
      validateCandidateManifest(
        candidateManifest({ serverImage: available(locator({ algorithm: "md5" as never })) }),
      ),
    /algorithm/,
  );
});

test("an unavailable slot must carry a reason but does not fail validation by itself", () => {
  assert.doesNotThrow(() => validateCandidateManifest(candidateManifest({ selfHostBundle: unavailable("not built") })));
  assert.throws(
    () => validateCandidateManifest(candidateManifest({ selfHostBundle: { available: false, reason: "" } })),
    /must carry a reason/,
  );
});

test("selected-world artifact completeness: managed-cloud needs its slots available", () => {
  const complete = assertSelectedWorldArtifacts(candidateManifest(), null, ["managed-cloud"], "linux-x86_64");
  assert.equal(complete.complete, true);
  assert.deepEqual(complete.missing, []);

  const missingTemplate = assertSelectedWorldArtifacts(
    candidateManifest({ e2bTemplate: unavailable() }),
    null,
    ["managed-cloud"],
    "linux-x86_64",
  );
  assert.equal(missingTemplate.complete, false);
  assert.ok(missingTemplate.missing.includes("candidate.e2bTemplate"));
});

test("Tier-4 world completeness requires the retained manifest and its slots", () => {
  const noRetained = assertSelectedWorldArtifacts(candidateManifest(), null, ["desktop-upgrade"], "darwin-aarch64");
  assert.equal(noRetained.complete, false);
  assert.ok(noRetained.missing.some((m) => m.includes("retained-manifest-absent")));

  const withRetained = assertSelectedWorldArtifacts(
    candidateManifest(),
    retainedManifest(),
    ["desktop-upgrade"],
    "darwin-aarch64",
  );
  assert.equal(withRetained.complete, true);
});

test("availableCandidateSlots respects the host platform for platform-keyed families", () => {
  const manifest = candidateManifest();
  // worker only has linux-x86_64 in the fixture.
  const linux = availableCandidateSlots(manifest, "linux-x86_64");
  assert.ok(linux.has("worker"));
  const darwin = availableCandidateSlots(manifest, "darwin-aarch64");
  assert.ok(!darwin.has("worker"), "no darwin worker slot in fixture");
  assert.ok(darwin.has("anyharness"), "anyharness has a darwin slot");
});
