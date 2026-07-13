import assert from "node:assert/strict";
import { test } from "node:test";

import type { Slot, TemplateSlot } from "../../contracts/artifacts.js";
import {
  isImmutableTemplateRef,
  isRollingTemplateRef,
  resolveCandidateTemplateIdentity,
  TemplateIdentityError,
  type E2BTemplateResolver,
} from "./template-identity.js";

test("isImmutableTemplateRef accepts sha- refs and build UUIDs", () => {
  assert.ok(isImmutableTemplateRef("sha-deadbeef0011"));
  assert.ok(isImmutableTemplateRef("3f2504e0-4f89-41d3-9a0c-0305e82c3301"));
});

test("isImmutableTemplateRef rejects rolling forms", () => {
  for (const ref of ["base", "latest", "stable", "v1", "v22", ""]) {
    assert.equal(isImmutableTemplateRef(ref), false, ref);
    assert.equal(isRollingTemplateRef(ref), true, ref);
  }
});

const immutableSlot: Slot<TemplateSlot> = {
  available: true,
  value: { templateId: "sha-abc123def456", inputHash: "hash-1" },
};

test("resolves directly when the candidate slot is already immutable — no resolver call", async () => {
  const resolved = await resolveCandidateTemplateIdentity({ candidateSlot: immutableSlot });
  assert.equal(resolved.slot.templateId, "sha-abc123def456");
  assert.equal(resolved.wasAlreadyImmutable, true);
});

test("rejects an immutable slot with an empty input hash", async () => {
  await assert.rejects(
    resolveCandidateTemplateIdentity({
      candidateSlot: { available: true, value: { templateId: "sha-abc123def456", inputHash: "" } },
    }),
    TemplateIdentityError,
  );
});

test("resolves a rolling ref to an immutable build via the resolver and records how", async () => {
  const resolver: E2BTemplateResolver = {
    resolveImmutableBuild: async (alias) => ({ buildId: "sha-999888777666", how: `e2b.templates.get(${alias}).latestBuild` }),
  };
  const resolved = await resolveCandidateTemplateIdentity({
    candidateSlot: { available: false, reason: "not built for local run" },
    observedRollingRef: "base",
    resolver,
  });
  assert.equal(resolved.slot.templateId, "sha-999888777666");
  assert.equal(resolved.wasAlreadyImmutable, false);
  assert.ok(resolved.resolution.includes("base"));
  assert.ok(resolved.resolution.includes("sha-999888777666"));
  assert.equal(resolved.slot.inputHash, "resolved-build:sha-999888777666");
});

test("throws when only a rolling ref is available and no resolver can pin it", async () => {
  await assert.rejects(
    resolveCandidateTemplateIdentity({
      candidateSlot: { available: true, value: { templateId: "v1", inputHash: "h" } },
      observedRollingRef: "base",
      resolver: null,
    }),
    (err: Error) => {
      assert.ok(err instanceof TemplateIdentityError);
      assert.ok(/rolling/i.test(err.message));
      return true;
    },
  );
});

test("throws when the resolver returns a still-rolling build id", async () => {
  const resolver: E2BTemplateResolver = {
    resolveImmutableBuild: async () => ({ buildId: "still-rolling", how: "bad" }),
  };
  await assert.rejects(
    resolveCandidateTemplateIdentity({
      candidateSlot: { available: false, reason: "x" },
      observedRollingRef: "base",
      resolver,
    }),
    TemplateIdentityError,
  );
});

test("throws when the slot is unavailable and no observed ref is supplied", async () => {
  await assert.rejects(
    resolveCandidateTemplateIdentity({ candidateSlot: { available: false, reason: "not built" } }),
    TemplateIdentityError,
  );
});
