import assert from "node:assert/strict";
import test from "node:test";

import { parseTags, planTagActions, validateTagTargets } from "./create-release-tags.mjs";

test("parses a tag CSV, trimming whitespace and dropping blanks", () => {
  assert.deepEqual(parseTags(" desktop-v0.1.3 , release-2026-07-09 ,,"), [
    "desktop-v0.1.3",
    "release-2026-07-09",
  ]);
});

test("validateTagTargets passes when a tag does not exist yet", () => {
  assert.doesNotThrow(() =>
    validateTagTargets({
      tags: ["desktop-v0.1.3"],
      target: "sha-new",
      existingTargets: {},
    }),
  );
});

test("validateTagTargets passes when a tag already points at the target", () => {
  assert.doesNotThrow(() =>
    validateTagTargets({
      tags: ["desktop-v0.1.3"],
      target: "sha-a",
      existingTargets: { "desktop-v0.1.3": "sha-a" },
    }),
  );
});

test("validateTagTargets fails a version tag pinned to a different sha", () => {
  assert.throws(
    () =>
      validateTagTargets({
        tags: ["desktop-v0.1.3"],
        target: "sha-b",
        existingTargets: { "desktop-v0.1.3": "sha-a" },
      }),
    /desktop-v0\.1\.3 exists at sha-a, not sha-b/,
  );
});

test("validateTagTargets reports every conflicting tag, not just the first", () => {
  assert.throws(
    () =>
      validateTagTargets({
        tags: ["desktop-v0.1.3", "server-v0.1.3"],
        target: "sha-b",
        existingTargets: { "desktop-v0.1.3": "sha-a", "server-v0.1.3": "sha-a" },
      }),
    /desktop-v0\.1\.3 exists at sha-a, not sha-b.*server-v0\.1\.3 exists at sha-a, not sha-b/,
  );
});

test("validateTagTargets exempts movable tags from the same-day collision", () => {
  // This is the actual nightly-release-train bug: release-2026-07-09 was cut
  // by an earlier run today at sha-a, and this rerun wants it at sha-b. A
  // movable checkpoint tag should not hard-fail the whole train.
  assert.doesNotThrow(() =>
    validateTagTargets({
      tags: ["proliferate-v0.2.14", "release-2026-07-09"],
      target: "sha-b",
      existingTargets: { "release-2026-07-09": "sha-a" },
      movableTags: ["release-2026-07-09"],
    }),
  );
});

test("validateTagTargets still fails a real version tag collision even alongside a movable tag", () => {
  assert.throws(
    () =>
      validateTagTargets({
        tags: ["desktop-v0.1.3", "release-2026-07-09"],
        target: "sha-b",
        existingTargets: { "desktop-v0.1.3": "sha-a", "release-2026-07-09": "sha-a" },
        movableTags: ["release-2026-07-09"],
      }),
    /desktop-v0\.1\.3 exists at sha-a, not sha-b/,
  );
});

test("planTagActions creates tags that do not exist yet", () => {
  const actions = planTagActions({
    tags: ["desktop-v0.1.3"],
    target: "sha-b",
    existingTargets: {},
  });
  assert.deepEqual(actions, [{ tag: "desktop-v0.1.3", action: "create", from: "", to: "sha-b" }]);
});

test("planTagActions skips a tag that already points at the target", () => {
  const actions = planTagActions({
    tags: ["desktop-v0.1.3"],
    target: "sha-a",
    existingTargets: { "desktop-v0.1.3": "sha-a" },
  });
  assert.deepEqual(actions, [{ tag: "desktop-v0.1.3", action: "skip", from: "sha-a", to: "sha-a" }]);
});

test("planTagActions retargets a movable tag pointing at a different sha", () => {
  const actions = planTagActions({
    tags: ["release-2026-07-09"],
    target: "sha-b",
    existingTargets: { "release-2026-07-09": "sha-a" },
    movableTags: ["release-2026-07-09"],
  });
  assert.deepEqual(actions, [
    { tag: "release-2026-07-09", action: "retarget", from: "sha-a", to: "sha-b" },
  ]);
});

test("planTagActions plans a same-day rerun correctly across mixed tag types", () => {
  // Mirrors an actual nightly rerun: the product/artifact tags are brand new
  // (prepare-artifact-release.mjs always bumps past existing tags) while the
  // date checkpoint tag from the earlier run today needs to move forward.
  const actions = planTagActions({
    tags: ["proliferate-v0.2.15", "desktop-v0.2.15", "release-2026-07-09"],
    target: "sha-b",
    existingTargets: {
      "proliferate-v0.2.14": "sha-a", // not part of this run's tag list
      "release-2026-07-09": "sha-a",
    },
    movableTags: ["release-2026-07-09"],
  });
  assert.deepEqual(actions, [
    { tag: "proliferate-v0.2.15", action: "create", from: "", to: "sha-b" },
    { tag: "desktop-v0.2.15", action: "create", from: "", to: "sha-b" },
    { tag: "release-2026-07-09", action: "retarget", from: "sha-a", to: "sha-b" },
  ]);
});
